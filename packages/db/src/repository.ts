import { Database } from "bun:sqlite";
import type {
  Session,
  Agent,
  Span,
  ToolCall,
  RawEvent,
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
    avgMs: number;
    p95Ms: number;
    errors: number;
  }>;
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

  getAggregate(sessionIds: string[]): AggregateData {
    if (sessionIds.length === 0) {
      return { totals: { cost: 0, inputTokens: 0, outputTokens: 0, cacheReadTokens: 0 }, tokensOverTime: [], timeBreakdown: [] };
    }

    const placeholders = sessionIds.map(() => "?").join(",");

    // Totals
    const totalsStmt = this.db.prepare(`
      SELECT
        SUM(estimated_cost_usd) as cost,
        SUM(total_input_tokens) as input_tokens,
        SUM(total_output_tokens) as output_tokens,
        SUM(total_cache_read_tokens) as cache_read_tokens
      FROM sessions
      WHERE session_id IN (${placeholders})
    `);
    const totalsRow = totalsStmt.get(...sessionIds) as Record<string, number>;

    // Tokens over time (from spans with LLM activity)
    const tokensStmt = this.db.prepare(`
      SELECT
        start_ts as ts,
        input_tokens,
        output_tokens,
        cache_read_tokens
      FROM spans
      WHERE session_id IN (${placeholders})
        AND (input_tokens > 0 OR output_tokens > 0)
      ORDER BY start_ts ASC
    `);
    const tokensRows = tokensStmt.all(...sessionIds) as Array<{
      ts: number;
      input_tokens: number;
      output_tokens: number;
      cache_read_tokens: number;
    }>;

    // Bucket tokens by time interval
    const bucketedTokens = this.bucketTokensByTime(tokensRows);

    // Time breakdown - LLM spans
    const llmStmt = this.db.prepare(`
      SELECT
        model,
        COUNT(*) as calls,
        SUM(duration_ms) as total_ms,
        AVG(duration_ms) as avg_ms,
        SUM(CASE WHEN status = 'error' THEN 1 ELSE 0 END) as errors
      FROM spans
      WHERE session_id IN (${placeholders})
        AND span_type = 'agent_llm_active'
      GROUP BY model
    `);
    const llmRows = llmStmt.all(...sessionIds) as Array<{
      model: string | null;
      calls: number;
      total_ms: number;
      avg_ms: number;
      errors: number;
    }>;

    // Time breakdown - tools
    const toolStats = this.getToolStatsMulti(sessionIds);

    const timeBreakdown: AggregateData["timeBreakdown"] = [];

    // Add LLM
    for (const row of llmRows) {
      timeBreakdown.push({
        name: row.model ? `LLM (${row.model.split("-").slice(0, 3).join("-")})` : "LLM",
        type: "llm",
        calls: row.calls,
        totalMs: row.total_ms,
        avgMs: row.avg_ms,
        p95Ms: 0,
        errors: row.errors,
      });
    }

    // Add tools
    for (const tool of toolStats) {
      timeBreakdown.push({
        name: tool.mcpServer ? `${tool.mcpServer}::${tool.toolName}` : tool.toolName,
        type: tool.toolFamily === "mcp" ? "mcp" : "builtin",
        calls: tool.callCount,
        totalMs: tool.totalDurationMs,
        avgMs: tool.avgDurationMs,
        p95Ms: tool.p95DurationMs,
        errors: tool.errorCount,
      });
    }

    // Sort by totalMs DESC
    timeBreakdown.sort((a, b) => b.totalMs - a.totalMs);

    return {
      totals: {
        cost: totalsRow.cost ?? 0,
        inputTokens: totalsRow.input_tokens ?? 0,
        outputTokens: totalsRow.output_tokens ?? 0,
        cacheReadTokens: totalsRow.cache_read_tokens ?? 0,
      },
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

    // Fill gaps with zeros between min and max
    const startBucket = Math.floor(minTs / bucketMs) * bucketMs;
    const endBucket = Math.floor(maxTs / bucketMs) * bucketMs;
    const result: Array<{ ts: number; inputTokens: number; outputTokens: number; cacheReadTokens: number }> = [];

    for (let ts = startBucket; ts <= endBucket; ts += bucketMs) {
      const data = buckets.get(ts);
      result.push({
        ts,
        inputTokens: data?.input ?? 0,
        outputTokens: data?.output ?? 0,
        cacheReadTokens: data?.cache ?? 0,
      });
    }

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
}
