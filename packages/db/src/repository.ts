import { Database } from "bun:sqlite";
import type {
  Session,
  Agent,
  Span,
  ToolCall,
  RawEvent,
  ChatMessage,
  ChatContentBlock,
  AgentInfo,
  MessagesResponse,
} from "@ccray/shared";

export interface ToolStats {
  toolName: string;
  toolFamily: string;
  mcpServer: string | null;
  callCount: number;
  totalDurationMs: number;
  avgDurationMs: number;
  p50DurationMs: number;
  p95DurationMs: number;
  maxDurationMs: number;
  errorCount: number;
  errorRate: number;
  totalInputBytes: number;
  totalOutputBytes: number;
}

export interface AggregateData {
  totals: {
    cost: number;
    inputTokens: number;
    outputTokens: number;
    cacheReadTokens: number;
    durationMs: number;
  };
  tokensOverTime: Array<{
    ts: number;
    inputTokens: number;
    outputTokens: number;
    cacheReadTokens: number;
  }>;
  timeBreakdown: Array<{
    name: string;
    type: "llm" | "builtin" | "mcp";
    calls: number;
    totalMs: number;
    wallClockMs: number;
    pctOfSession: number;
    avgMs: number;
    p95Ms: number;
    errors: number;
  }>;
}

// Max reasonable duration for a single span (10 minutes)
// Spans longer than this are likely bad data from unclosed spans
const MAX_SPAN_DURATION_MS = 10 * 60 * 1000;

interface TaggedInterval {
  startTs: number;
  endTs: number;
  category: string;
}

/**
 * Attribute time proportionally across overlapping intervals.
 * When multiple categories are active at the same time, split the time evenly.
 * This ensures the sum of attributed times equals the total wall clock time.
 */
function attributeProportional(intervals: TaggedInterval[]): Map<string, number> {
  const attribution = new Map<string, number>();

  if (intervals.length === 0) return attribution;

  // Sanitize intervals (cap unreasonable durations)
  const sanitized = intervals.map((iv) => {
    const duration = iv.endTs - iv.startTs;
    if (duration <= MAX_SPAN_DURATION_MS) {
      return iv;
    }
    return { ...iv, endTs: iv.startTs + MAX_SPAN_DURATION_MS };
  });

  // Collect all unique time points
  const timePoints = new Set<number>();
  for (const iv of sanitized) {
    timePoints.add(iv.startTs);
    timePoints.add(iv.endTs);
  }
  const sortedTimes = Array.from(timePoints).sort((a, b) => a - b);

  // For each time segment, split duration among active categories
  for (let i = 0; i < sortedTimes.length - 1; i++) {
    const segStart = sortedTimes[i];
    const segEnd = sortedTimes[i + 1];
    const segDuration = segEnd - segStart;

    // Find all intervals active during this segment
    const activeCategories = new Set<string>();
    for (const iv of sanitized) {
      if (iv.startTs <= segStart && segEnd <= iv.endTs) {
        activeCategories.add(iv.category);
      }
    }

    if (activeCategories.size === 0) continue;

    // Split evenly among active categories
    const share = segDuration / activeCategories.size;
    for (const cat of activeCategories) {
      attribution.set(cat, (attribution.get(cat) ?? 0) + share);
    }
  }

  return attribution;
}

function mergeIntervals(spans: Array<{ startTs: number; endTs: number; durationMs?: number }>): number {
  if (spans.length === 0) return 0;

  // Sanitize: cap unreasonable durations using durationMs as fallback if available
  const sanitized = spans.map((s) => {
    const intervalDuration = s.endTs - s.startTs;
    if (intervalDuration <= MAX_SPAN_DURATION_MS) {
      return { startTs: s.startTs, endTs: s.endTs };
    }
    // Use durationMs if available and reasonable, otherwise cap
    const duration = s.durationMs !== undefined && s.durationMs <= MAX_SPAN_DURATION_MS
      ? s.durationMs
      : MAX_SPAN_DURATION_MS;
    return { startTs: s.startTs, endTs: s.startTs + duration };
  });

  // Sort by start time
  const sorted = sanitized.sort((a, b) => a.startTs - b.startTs);

  let totalMs = 0;
  let currentStart = sorted[0].startTs;
  let currentEnd = sorted[0].endTs;

  for (let i = 1; i < sorted.length; i++) {
    if (sorted[i].startTs <= currentEnd) {
      // Overlapping - extend current interval
      currentEnd = Math.max(currentEnd, sorted[i].endTs);
    } else {
      // Gap - finalize current interval, start new one
      totalMs += currentEnd - currentStart;
      currentStart = sorted[i].startTs;
      currentEnd = sorted[i].endTs;
    }
  }
  totalMs += currentEnd - currentStart;

  return totalMs;
}

export class Repository {
  private db: Database;

  constructor(db: Database) {
    this.db = db;
  }

  insertSession(session: Session): void {
    const stmt = this.db.prepare(`
      INSERT OR REPLACE INTO sessions (
        session_id, project_path, start_ts, end_ts, duration_ms,
        total_input_tokens, total_output_tokens, total_cache_read_tokens,
        total_cache_write_tokens, estimated_cost_usd, first_message
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    stmt.run(
      session.sessionId,
      session.projectPath,
      session.startTs,
      session.endTs,
      session.durationMs,
      session.totalInputTokens,
      session.totalOutputTokens,
      session.totalCacheReadTokens,
      session.totalCacheWriteTokens,
      session.estimatedCostUsd,
      session.firstMessage
    );
  }

  getSession(sessionId: string): Session | null {
    const stmt = this.db.prepare(`
      SELECT
        session_id, project_path, start_ts, end_ts, duration_ms,
        total_input_tokens, total_output_tokens, total_cache_read_tokens,
        total_cache_write_tokens, estimated_cost_usd, first_message
      FROM sessions
      WHERE session_id = ?
    `);
    const row = stmt.get(sessionId) as Record<string, unknown> | null;
    if (!row) return null;
    return this.rowToSession(row);
  }

  listSessions(): Session[] {
    const stmt = this.db.prepare(`
      SELECT
        session_id, project_path, start_ts, end_ts, duration_ms,
        total_input_tokens, total_output_tokens, total_cache_read_tokens,
        total_cache_write_tokens, estimated_cost_usd, first_message
      FROM sessions
      ORDER BY start_ts DESC
    `);
    const rows = stmt.all() as Record<string, unknown>[];
    return rows.map((row) => this.rowToSession(row));
  }

  private rowToSession(row: Record<string, unknown>): Session {
    return {
      sessionId: row.session_id as string,
      projectPath: row.project_path as string,
      startTs: row.start_ts as number,
      endTs: row.end_ts as number,
      durationMs: row.duration_ms as number,
      totalInputTokens: row.total_input_tokens as number,
      totalOutputTokens: row.total_output_tokens as number,
      totalCacheReadTokens: row.total_cache_read_tokens as number,
      totalCacheWriteTokens: row.total_cache_write_tokens as number,
      estimatedCostUsd: row.estimated_cost_usd as number,
      firstMessage: (row.first_message as string) ?? null,
    };
  }

  insertAgent(agent: Agent): void {
    const stmt = this.db.prepare(`
      INSERT OR REPLACE INTO agents (
        agent_id, session_id, parent_agent_id, kind, transcript_path,
        start_ts, end_ts, link_confidence, total_input_tokens,
        total_output_tokens, estimated_cost_usd
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    stmt.run(
      agent.agentId,
      agent.sessionId,
      agent.parentAgentId,
      agent.kind,
      agent.transcriptPath,
      agent.startTs,
      agent.endTs,
      agent.linkConfidence,
      agent.totalInputTokens,
      agent.totalOutputTokens,
      agent.estimatedCostUsd
    );
  }

  getAgents(sessionId: string): Agent[] {
    const stmt = this.db.prepare(`
      SELECT
        agent_id, session_id, parent_agent_id, kind, transcript_path,
        start_ts, end_ts, link_confidence, total_input_tokens,
        total_output_tokens, estimated_cost_usd
      FROM agents
      WHERE session_id = ?
      ORDER BY start_ts ASC
    `);
    const rows = stmt.all(sessionId) as Record<string, unknown>[];
    return rows.map((row) => this.rowToAgent(row));
  }

  private rowToAgent(row: Record<string, unknown>): Agent {
    return {
      agentId: row.agent_id as string,
      sessionId: row.session_id as string,
      parentAgentId: row.parent_agent_id as string | null,
      kind: row.kind as "main" | "subagent",
      transcriptPath: row.transcript_path as string,
      startTs: row.start_ts as number,
      endTs: row.end_ts as number,
      linkConfidence: row.link_confidence as number,
      totalInputTokens: row.total_input_tokens as number,
      totalOutputTokens: row.total_output_tokens as number,
      estimatedCostUsd: row.estimated_cost_usd as number,
    };
  }

  insertSpan(span: Span): void {
    const stmt = this.db.prepare(`
      INSERT OR REPLACE INTO spans (
        span_id, session_id, agent_id, parent_span_id, span_type,
        start_ts, end_ts, duration_ms, status, input_tokens,
        output_tokens, cache_read_tokens, cache_write_tokens, model
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    stmt.run(
      span.spanId,
      span.sessionId,
      span.agentId,
      span.parentSpanId,
      span.spanType,
      span.startTs,
      span.endTs,
      span.durationMs,
      span.status,
      span.inputTokens,
      span.outputTokens,
      span.cacheReadTokens,
      span.cacheWriteTokens,
      span.model
    );
  }

  getSpans(sessionId: string): Span[] {
    const stmt = this.db.prepare(`
      SELECT
        span_id, session_id, agent_id, parent_span_id, span_type,
        start_ts, end_ts, duration_ms, status, input_tokens,
        output_tokens, cache_read_tokens, cache_write_tokens, model
      FROM spans
      WHERE session_id = ?
      ORDER BY start_ts ASC
    `);
    const rows = stmt.all(sessionId) as Record<string, unknown>[];
    return rows.map((row) => this.rowToSpan(row));
  }

  private rowToSpan(row: Record<string, unknown>): Span {
    return {
      spanId: row.span_id as string,
      sessionId: row.session_id as string,
      agentId: row.agent_id as string,
      parentSpanId: row.parent_span_id as string | null,
      spanType: row.span_type as Span["spanType"],
      startTs: row.start_ts as number,
      endTs: row.end_ts as number,
      durationMs: row.duration_ms as number,
      status: row.status as "success" | "error" | "unknown",
      inputTokens: row.input_tokens as number,
      outputTokens: row.output_tokens as number,
      cacheReadTokens: row.cache_read_tokens as number,
      cacheWriteTokens: row.cache_write_tokens as number,
      model: row.model as string | null,
    };
  }

  insertToolCall(toolCall: ToolCall): void {
    const stmt = this.db.prepare(`
      INSERT OR REPLACE INTO tool_calls (
        tool_call_id, span_id, session_id, agent_id, tool_family,
        tool_name, mcp_server, status, error_type, input_bytes, output_bytes
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    stmt.run(
      toolCall.toolCallId,
      toolCall.spanId,
      toolCall.sessionId,
      toolCall.agentId,
      toolCall.toolFamily,
      toolCall.toolName,
      toolCall.mcpServer,
      toolCall.status,
      toolCall.errorType,
      toolCall.inputBytes,
      toolCall.outputBytes
    );
  }

  insertEvent(event: RawEvent): void {
    const stmt = this.db.prepare(`
      INSERT OR REPLACE INTO events (
        event_id, session_id, agent_id, ts, raw_type,
        norm_type, raw_line_no, raw_json
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);
    stmt.run(
      event.eventId,
      event.sessionId,
      event.agentId,
      event.ts,
      event.rawType,
      event.normType,
      event.rawLineNo,
      event.rawJson
    );
  }

  getToolStats(sessionId: string): ToolStats[] {
    // First, get all tool calls with their durations
    const stmt = this.db.prepare(`
      SELECT
        tc.tool_name,
        tc.tool_family,
        tc.mcp_server,
        tc.status,
        tc.input_bytes,
        tc.output_bytes,
        s.duration_ms
      FROM tool_calls tc
      JOIN spans s ON tc.span_id = s.span_id
      WHERE tc.session_id = ?
      ORDER BY tc.tool_name, tc.tool_family, tc.mcp_server
    `);

    const rows = stmt.all(sessionId) as Array<{
      tool_name: string;
      tool_family: string;
      mcp_server: string | null;
      status: string;
      input_bytes: number;
      output_bytes: number;
      duration_ms: number;
    }>;

    // Group by tool_name, tool_family, mcp_server
    const groups = new Map<string, typeof rows>();
    for (const row of rows) {
      const key = `${row.tool_name}|${row.tool_family}|${row.mcp_server ?? ""}`;
      const group = groups.get(key) ?? [];
      group.push(row);
      groups.set(key, group);
    }

    // Compute stats for each group
    const stats: ToolStats[] = [];
    for (const [, group] of groups) {
      const first = group[0];
      const durations = group.map((r) => r.duration_ms).sort((a, b) => a - b);
      const callCount = group.length;
      const errorCount = group.filter((r) => r.status === "error").length;
      const totalDurationMs = durations.reduce((sum, d) => sum + d, 0);
      const totalInputBytes = group.reduce((sum, r) => sum + r.input_bytes, 0);
      const totalOutputBytes = group.reduce((sum, r) => sum + r.output_bytes, 0);

      stats.push({
        toolName: first.tool_name,
        toolFamily: first.tool_family,
        mcpServer: first.mcp_server,
        callCount,
        totalDurationMs,
        avgDurationMs: totalDurationMs / callCount,
        p50DurationMs: this.percentile(durations, 50),
        p95DurationMs: this.percentile(durations, 95),
        maxDurationMs: durations[durations.length - 1] ?? 0,
        errorCount,
        errorRate: errorCount / callCount,
        totalInputBytes,
        totalOutputBytes,
      });
    }

    // Sort by totalDurationMs DESC
    stats.sort((a, b) => b.totalDurationMs - a.totalDurationMs);

    return stats;
  }

  private percentile(sortedArr: number[], p: number): number {
    if (sortedArr.length === 0) return 0;
    const index = Math.ceil((p / 100) * sortedArr.length) - 1;
    return sortedArr[Math.max(0, index)];
  }

  getAggregate(sessionIds: string[], startTime?: number, endTime?: number): AggregateData {
    if (sessionIds.length === 0) {
      return { totals: { cost: 0, inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, durationMs: 0 }, tokensOverTime: [], timeBreakdown: [] };
    }

    const placeholders = sessionIds.map(() => "?").join(",");

    const timeFilter = startTime !== undefined && endTime !== undefined
      ? ` AND start_ts >= ${startTime} AND start_ts <= ${endTime}`
      : "";

    // Totals (including total duration)
    const totalsStmt = this.db.prepare(`
      SELECT
        SUM(estimated_cost_usd) as cost,
        SUM(total_input_tokens) as input_tokens,
        SUM(total_output_tokens) as output_tokens,
        SUM(total_cache_read_tokens) as cache_read_tokens,
        SUM(duration_ms) as duration_ms
      FROM sessions
      WHERE session_id IN (${placeholders})
    `);
    const totalsRow = totalsStmt.get(...sessionIds) as Record<string, number>;
    const totalDurationMs = totalsRow.duration_ms ?? 0;

    // Tokens over time (from spans with LLM activity)
    const tokensStmt = this.db.prepare(`
      SELECT
        start_ts as ts,
        input_tokens,
        output_tokens,
        cache_read_tokens
      FROM spans
      WHERE session_id IN (${placeholders})
        AND (input_tokens > 0 OR output_tokens > 0)${timeFilter}
      ORDER BY start_ts ASC
    `);
    const tokensRows = tokensStmt.all(...sessionIds) as Array<{
      ts: number;
      input_tokens: number;
      output_tokens: number;
      cache_read_tokens: number;
    }>;

    // Calculate totals - from filtered spans when time filter is active, otherwise from sessions
    let totals: { cost: number; inputTokens: number; outputTokens: number; cacheReadTokens: number; durationMs: number };

    if (startTime !== undefined && endTime !== undefined) {
      // Calculate from filtered spans
      const inputTokens = tokensRows.reduce((sum, r) => sum + r.input_tokens, 0);
      const outputTokens = tokensRows.reduce((sum, r) => sum + r.output_tokens, 0);
      const cacheReadTokens = tokensRows.reduce((sum, r) => sum + r.cache_read_tokens, 0);
      totals = { cost: 0, inputTokens, outputTokens, cacheReadTokens, durationMs: 0 };
    } else {
      // Use session totals (existing logic)
      totals = {
        cost: totalsRow.cost ?? 0,
        inputTokens: totalsRow.input_tokens ?? 0,
        outputTokens: totalsRow.output_tokens ?? 0,
        cacheReadTokens: totalsRow.cache_read_tokens ?? 0,
        durationMs: 0,
      };
    }

    // Bucket tokens by time interval
    const bucketedTokens = this.bucketTokensByTime(tokensRows);

    // Get all span intervals for wall clock computation
    // LLM spans with their intervals
    const llmIntervalsStmt = this.db.prepare(`
      SELECT
        model,
        start_ts,
        end_ts,
        duration_ms,
        status
      FROM spans
      WHERE session_id IN (${placeholders})
        AND span_type = 'agent_llm_active'${timeFilter}
      ORDER BY model
    `);
    const llmIntervalRows = llmIntervalsStmt.all(...sessionIds) as Array<{
      model: string | null;
      start_ts: number;
      end_ts: number;
      duration_ms: number;
      status: string;
    }>;

    // Tool spans with their intervals
    const toolIntervalsStmt = this.db.prepare(`
      SELECT
        tc.tool_name,
        tc.tool_family,
        tc.mcp_server,
        tc.status,
        s.start_ts,
        s.end_ts,
        s.duration_ms
      FROM tool_calls tc
      JOIN spans s ON tc.span_id = s.span_id
      WHERE tc.session_id IN (${placeholders})${timeFilter}
      ORDER BY tc.tool_name, tc.tool_family, tc.mcp_server
    `);
    const toolIntervalRows = toolIntervalsStmt.all(...sessionIds) as Array<{
      tool_name: string;
      tool_family: string;
      mcp_server: string | null;
      status: string;
      start_ts: number;
      end_ts: number;
      duration_ms: number;
    }>;

    // Compute total ACTIVE session duration by merging all span intervals
    // This excludes idle time (laptop closed, user away, etc.)
    const allIntervals: Array<{ startTs: number; endTs: number; durationMs: number }> = [];
    for (const r of llmIntervalRows) {
      allIntervals.push({ startTs: r.start_ts, endTs: r.end_ts, durationMs: r.duration_ms });
    }
    for (const r of toolIntervalRows) {
      allIntervals.push({ startTs: r.start_ts, endTs: r.end_ts, durationMs: r.duration_ms });
    }
    const activeDurationMs = mergeIntervals(allIntervals);

    // Build tagged intervals for proportional attribution
    // This ensures pctOfSession sums to 100% even when categories overlap
    const taggedIntervals: TaggedInterval[] = [];

    // Group LLM intervals by model
    const llmGroups = new Map<string, typeof llmIntervalRows>();
    for (const row of llmIntervalRows) {
      const key = row.model ?? "unknown";
      const group = llmGroups.get(key) ?? [];
      group.push(row);
      llmGroups.set(key, group);
    }

    // Build category names and add to tagged intervals
    const llmCategoryNames = new Map<string, string>();
    for (const [model, rows] of llmGroups) {
      const categoryName = model !== "unknown" ? `LLM (${model.split("-").slice(0, 3).join("-")})` : "LLM";
      llmCategoryNames.set(model, categoryName);
      for (const r of rows) {
        taggedIntervals.push({ startTs: r.start_ts, endTs: r.end_ts, category: categoryName });
      }
    }

    // Group tool intervals
    const toolGroups = new Map<string, typeof toolIntervalRows>();
    for (const row of toolIntervalRows) {
      const key = `${row.tool_name}|${row.tool_family}|${row.mcp_server ?? ""}`;
      const group = toolGroups.get(key) ?? [];
      group.push(row);
      toolGroups.set(key, group);
    }

    const toolCategoryNames = new Map<string, string>();
    for (const [key, rows] of toolGroups) {
      const first = rows[0];
      const categoryName = first.mcp_server ? `${first.mcp_server}::${first.tool_name}` : first.tool_name;
      toolCategoryNames.set(key, categoryName);
      for (const r of rows) {
        taggedIntervals.push({ startTs: r.start_ts, endTs: r.end_ts, category: categoryName });
      }
    }

    // Compute proportional attribution (for pctOfSession that sums to 100%)
    const proportionalAttribution = attributeProportional(taggedIntervals);

    const timeBreakdown: AggregateData["timeBreakdown"] = [];

    // Build LLM breakdown entries
    for (const [model, rows] of llmGroups) {
      // Cap individual durations to avoid idle time skewing averages
      const sanitizedDurations = rows.map((r) => Math.min(r.duration_ms, MAX_SPAN_DURATION_MS));
      const totalMs = sanitizedDurations.reduce((sum, d) => sum + d, 0);
      const errors = rows.filter((r) => r.status === "error").length;

      const categoryName = llmCategoryNames.get(model)!;
      const wallClockMs = proportionalAttribution.get(categoryName) ?? 0;

      timeBreakdown.push({
        name: categoryName,
        type: "llm",
        calls: rows.length,
        totalMs,
        wallClockMs,
        pctOfSession: activeDurationMs > 0 ? (wallClockMs / activeDurationMs) * 100 : 0,
        avgMs: rows.length > 0 ? totalMs / rows.length : 0,
        p95Ms: this.percentile(sanitizedDurations.sort((a, b) => a - b), 95),
        errors,
      });
    }

    // Build tool breakdown entries
    for (const [key, rows] of toolGroups) {
      const first = rows[0];
      // Cap individual durations to avoid idle time skewing averages
      const durations = rows.map((r) => Math.min(r.duration_ms, MAX_SPAN_DURATION_MS)).sort((a, b) => a - b);
      const totalMs = durations.reduce((sum, d) => sum + d, 0);
      const errors = rows.filter((r) => r.status === "error").length;

      const categoryName = toolCategoryNames.get(key)!;
      const wallClockMs = proportionalAttribution.get(categoryName) ?? 0;

      timeBreakdown.push({
        name: categoryName,
        type: first.tool_family === "mcp" ? "mcp" : "builtin",
        calls: rows.length,
        totalMs,
        wallClockMs,
        pctOfSession: activeDurationMs > 0 ? (wallClockMs / activeDurationMs) * 100 : 0,
        avgMs: rows.length > 0 ? totalMs / rows.length : 0,
        p95Ms: this.percentile(durations, 95),
        errors,
      });
    }

    // Sort by wallClockMs DESC (proportional contribution to session time)
    timeBreakdown.sort((a, b) => b.wallClockMs - a.wallClockMs);

    // Update durationMs with the computed active duration
    totals.durationMs = activeDurationMs;

    return {
      totals,
      tokensOverTime: bucketedTokens,
      timeBreakdown,
    };
  }

  private bucketTokensByTime(
    rows: Array<{ ts: number; input_tokens: number; output_tokens: number; cache_read_tokens: number }>
  ): Array<{ ts: number; inputTokens: number; outputTokens: number; cacheReadTokens: number }> {
    if (rows.length === 0) return [];

    // Find time range
    const minTs = rows[0].ts;
    const maxTs = rows[rows.length - 1].ts;
    const rangeMs = maxTs - minTs;

    // Choose bucket size based on range (aim for ~50-100 buckets)
    // < 10 min: 10 second buckets
    // < 1 hour: 30 second buckets
    // < 6 hours: 2 minute buckets
    // < 1 day: 10 minute buckets
    // < 1 week: 30 minute buckets
    // >= 1 week: 2 hour buckets
    let bucketMs: number;
    if (rangeMs < 10 * 60 * 1000) {
      bucketMs = 10 * 1000; // 10 seconds
    } else if (rangeMs < 60 * 60 * 1000) {
      bucketMs = 30 * 1000; // 30 seconds
    } else if (rangeMs < 6 * 60 * 60 * 1000) {
      bucketMs = 2 * 60 * 1000; // 2 minutes
    } else if (rangeMs < 24 * 60 * 60 * 1000) {
      bucketMs = 10 * 60 * 1000; // 10 minutes
    } else if (rangeMs < 7 * 24 * 60 * 60 * 1000) {
      bucketMs = 30 * 60 * 1000; // 30 minutes
    } else {
      bucketMs = 2 * 60 * 60 * 1000; // 2 hours
    }

    // Group data into buckets
    const buckets = new Map<number, { input: number; output: number; cache: number }>();

    for (const row of rows) {
      const bucketTs = Math.floor(row.ts / bucketMs) * bucketMs;
      const existing = buckets.get(bucketTs) ?? { input: 0, output: 0, cache: 0 };
      existing.input += row.input_tokens;
      existing.output += row.output_tokens;
      existing.cache += row.cache_read_tokens;
      buckets.set(bucketTs, existing);
    }

    // Get sorted bucket timestamps
    const sortedBuckets = Array.from(buckets.keys()).sort((a, b) => a - b);

    // Build result with zero anchors before/after each data point
    const result: Array<{ ts: number; inputTokens: number; outputTokens: number; cacheReadTokens: number }> = [];
    const addedTimestamps = new Set<number>();

    for (const ts of sortedBuckets) {
      const data = buckets.get(ts)!;

      // Add zero point before if not adjacent to previous data
      const prevTs = ts - bucketMs;
      if (!buckets.has(prevTs) && !addedTimestamps.has(prevTs)) {
        result.push({ ts: prevTs, inputTokens: 0, outputTokens: 0, cacheReadTokens: 0 });
        addedTimestamps.add(prevTs);
      }

      // Add the actual data point
      if (!addedTimestamps.has(ts)) {
        result.push({
          ts,
          inputTokens: data.input,
          outputTokens: data.output,
          cacheReadTokens: data.cache,
        });
        addedTimestamps.add(ts);
      }

      // Add zero point after if not adjacent to next data
      const nextTs = ts + bucketMs;
      if (!buckets.has(nextTs) && !addedTimestamps.has(nextTs)) {
        result.push({ ts: nextTs, inputTokens: 0, outputTokens: 0, cacheReadTokens: 0 });
        addedTimestamps.add(nextTs);
      }
    }

    // Sort by timestamp
    result.sort((a, b) => a.ts - b.ts);
    return result;
  }

  getToolStatsMulti(sessionIds: string[]): ToolStats[] {
    const placeholders = sessionIds.map(() => "?").join(",");
    const stmt = this.db.prepare(`
      SELECT
        tc.tool_name,
        tc.tool_family,
        tc.mcp_server,
        tc.status,
        tc.input_bytes,
        tc.output_bytes,
        s.duration_ms
      FROM tool_calls tc
      JOIN spans s ON tc.span_id = s.span_id
      WHERE tc.session_id IN (${placeholders})
      ORDER BY tc.tool_name, tc.tool_family, tc.mcp_server
    `);

    const rows = stmt.all(...sessionIds) as Array<{
      tool_name: string;
      tool_family: string;
      mcp_server: string | null;
      status: string;
      input_bytes: number;
      output_bytes: number;
      duration_ms: number;
    }>;

    // Same grouping logic as getToolStats
    const groups = new Map<string, typeof rows>();
    for (const row of rows) {
      const key = `${row.tool_name}|${row.tool_family}|${row.mcp_server ?? ""}`;
      const group = groups.get(key) ?? [];
      group.push(row);
      groups.set(key, group);
    }

    const stats: ToolStats[] = [];
    for (const [, group] of groups) {
      const first = group[0];
      const durations = group.map((r) => r.duration_ms).sort((a, b) => a - b);
      const callCount = group.length;
      const errorCount = group.filter((r) => r.status === "error").length;
      const totalDurationMs = durations.reduce((sum, d) => sum + d, 0);
      const totalInputBytes = group.reduce((sum, r) => sum + r.input_bytes, 0);
      const totalOutputBytes = group.reduce((sum, r) => sum + r.output_bytes, 0);

      stats.push({
        toolName: first.tool_name,
        toolFamily: first.tool_family,
        mcpServer: first.mcp_server,
        callCount,
        totalDurationMs,
        avgDurationMs: totalDurationMs / callCount,
        p50DurationMs: this.percentile(durations, 50),
        p95DurationMs: this.percentile(durations, 95),
        maxDurationMs: durations[durations.length - 1] ?? 0,
        errorCount,
        errorRate: errorCount / callCount,
        totalInputBytes,
        totalOutputBytes,
      });
    }

    stats.sort((a, b) => b.totalDurationMs - a.totalDurationMs);
    return stats;
  }

  getMessages(sessionIds: string[], startTime?: number, endTime?: number): MessagesResponse {
    if (sessionIds.length === 0) {
      return { messages: [], agents: [] };
    }

    const placeholders = sessionIds.map(() => "?").join(",");
    let query = `
      SELECT e.event_id, e.session_id, e.agent_id, e.ts, e.raw_type, e.raw_json,
             a.kind as agent_kind
      FROM events e
      JOIN agents a ON e.agent_id = a.agent_id
      WHERE e.session_id IN (${placeholders})
        AND e.raw_type IN ('user', 'assistant', 'result')
    `;

    const params: (string | number)[] = [...sessionIds];

    if (startTime !== undefined && endTime !== undefined) {
      query += ` AND e.ts >= ? AND e.ts <= ?`;
      params.push(startTime, endTime);
    }

    query += ` ORDER BY e.ts ASC`;

    const stmt = this.db.prepare(query);
    const rows = stmt.all(...params) as Array<{
      event_id: string;
      session_id: string;
      agent_id: string;
      ts: number;
      raw_type: string;
      raw_json: string;
      agent_kind: "main" | "subagent";
    }>;

    const messages: ChatMessage[] = [];
    const agentMap = new Map<string, AgentInfo>();

    for (const row of rows) {
      const parsed = this.parseEventToMessage(row);
      if (parsed) {
        messages.push(parsed);

        if (!agentMap.has(row.agent_id)) {
          agentMap.set(row.agent_id, {
            agentId: row.agent_id,
            kind: row.agent_kind,
            label: row.agent_kind === "main" ? "Main" : `Subagent`,
          });
        }
      }
    }

    return {
      messages,
      agents: Array.from(agentMap.values()),
    };
  }

  private parseEventToMessage(row: {
    event_id: string;
    agent_id: string;
    ts: number;
    raw_type: string;
    raw_json: string;
    agent_kind: "main" | "subagent";
  }): ChatMessage | null {
    try {
      const raw = JSON.parse(row.raw_json);

      if (row.raw_type === "user") {
        const content = this.extractContentBlocks(raw.message?.content ?? []);
        return {
          eventId: row.event_id,
          agentId: row.agent_id,
          agentKind: row.agent_kind,
          ts: row.ts,
          role: "user",
          content,
        };
      }

      if (row.raw_type === "assistant") {
        const content = this.extractContentBlocks(raw.message?.content ?? []);
        return {
          eventId: row.event_id,
          agentId: row.agent_id,
          agentKind: row.agent_kind,
          ts: row.ts,
          role: "assistant",
          content,
        };
      }

      if (row.raw_type === "result") {
        const toolResult = raw.toolUseResult ?? raw.tool_result ?? {};
        const output = this.extractToolResultOutput(toolResult.content);
        const content: ChatContentBlock[] = [{
          type: "tool_result",
          toolId: toolResult.tool_use_id ?? "",
          output,
          isError: toolResult.is_error === true,
        }];
        return {
          eventId: row.event_id,
          agentId: row.agent_id,
          agentKind: row.agent_kind,
          ts: row.ts,
          role: "assistant",
          content,
        };
      }

      return null;
    } catch {
      return null;
    }
  }

  private extractContentBlocks(content: unknown[]): ChatContentBlock[] {
    if (!Array.isArray(content)) return [];

    const blocks: ChatContentBlock[] = [];

    for (const item of content) {
      if (typeof item !== "object" || item === null) continue;
      const block = item as Record<string, unknown>;

      if (block.type === "text" && typeof block.text === "string") {
        blocks.push({ type: "text", text: block.text });
      } else if (block.type === "thinking" && typeof block.thinking === "string") {
        blocks.push({ type: "thinking", text: block.thinking });
      } else if (block.type === "tool_use") {
        blocks.push({
          type: "tool_use",
          toolName: (block.name as string) ?? "unknown",
          toolId: (block.id as string) ?? "",
          input: block.input ?? {},
        });
      }
    }

    return blocks;
  }

  private extractToolResultOutput(content: unknown): string {
    if (typeof content === "string") return content;
    if (Array.isArray(content)) {
      return content
        .map((c) => {
          if (typeof c === "string") return c;
          if (typeof c === "object" && c !== null && "text" in c) {
            return (c as { text: string }).text;
          }
          return JSON.stringify(c);
        })
        .join("\n");
    }
    return JSON.stringify(content);
  }
}
