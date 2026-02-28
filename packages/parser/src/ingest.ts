import { Database } from "bun:sqlite";
import type { Session, Agent, Span, ToolCall } from "@ccray/shared";
import { estimateCost } from "@ccray/shared";
import { Repository, createSchema } from "@ccray/db";
import { discoverSessions, type DiscoveredSession } from "./discovery.js";
import { readJsonlLines } from "./reader.js";
import { normalizeEvent, type NormalizedEvent } from "./normalizer.js";

export interface IngestOptions {
  reindex?: boolean;
}

export async function ingestSession(
  db: Database,
  discovered: DiscoveredSession
): Promise<Session> {
  const repo = new Repository(db);

  // Parse main transcript
  const file = Bun.file(discovered.mainPath);
  const events: NormalizedEvent[] = [];

  let lineNo = 0;
  for await (const raw of readJsonlLines(file.stream())) {
    lineNo++;
    events.push(normalizeEvent(raw, lineNo));
  }

  // Calculate session stats
  const timestamps = events.map(e => e.ts).filter(t => t > 0);
  const startTs = Math.min(...timestamps);
  const endTs = Math.max(...timestamps);
  const durationMs = endTs - startTs;

  // Sum tokens
  let totalInputTokens = 0;
  let totalOutputTokens = 0;
  let totalCacheRead = 0;
  let totalCacheWrite = 0;
  let model: string | null = null;

  for (const event of events) {
    if (event.tokenUsage) {
      totalInputTokens += event.tokenUsage.inputTokens;
      totalOutputTokens += event.tokenUsage.outputTokens;
      totalCacheRead += event.tokenUsage.cacheReadInputTokens;
      totalCacheWrite += event.tokenUsage.cacheCreationInputTokens;
    }
    if (event.model) model = event.model;
  }

  const estimatedCostUsd = estimateCost(
    model,
    totalInputTokens,
    totalOutputTokens,
    totalCacheRead,
    totalCacheWrite
  );

  const session: Session = {
    sessionId: discovered.sessionId,
    projectPath: discovered.projectPath,
    startTs,
    endTs,
    durationMs,
    totalInputTokens,
    totalOutputTokens,
    totalCacheReadTokens: totalCacheRead,
    totalCacheWriteTokens: totalCacheWrite,
    estimatedCostUsd,
  };

  repo.insertSession(session);

  // Create main agent
  const agent: Agent = {
    agentId: discovered.sessionId,
    sessionId: discovered.sessionId,
    parentAgentId: null,
    kind: "main",
    transcriptPath: discovered.mainPath,
    startTs,
    endTs,
    linkConfidence: 1.0,
    totalInputTokens,
    totalOutputTokens,
    estimatedCostUsd,
  };

  repo.insertAgent(agent);

  // Create spans from events
  let prevEvent: NormalizedEvent | null = null;
  for (const event of events) {
    if (prevEvent && event.ts > prevEvent.ts) {
      const spanType = inferSpanType(prevEvent);
      const span: Span = {
        spanId: prevEvent.eventId,
        sessionId: discovered.sessionId,
        agentId: discovered.sessionId,
        parentSpanId: null,
        spanType,
        startTs: prevEvent.ts,
        endTs: event.ts,
        durationMs: event.ts - prevEvent.ts,
        status: "success",
        inputTokens: prevEvent.tokenUsage?.inputTokens ?? 0,
        outputTokens: prevEvent.tokenUsage?.outputTokens ?? 0,
        cacheReadTokens: prevEvent.tokenUsage?.cacheReadInputTokens ?? 0,
        cacheWriteTokens: prevEvent.tokenUsage?.cacheCreationInputTokens ?? 0,
        model: prevEvent.model ?? null,
      };

      repo.insertSpan(span);

      // Create tool call if applicable
      if (prevEvent.toolName) {
        const toolCall: ToolCall = {
          toolCallId: prevEvent.toolId ?? prevEvent.eventId,
          spanId: span.spanId,
          sessionId: discovered.sessionId,
          agentId: discovered.sessionId,
          toolFamily: prevEvent.mcpServer ? "mcp" : "builtin",
          toolName: prevEvent.toolName,
          mcpServer: prevEvent.mcpServer ?? null,
          status: "success",
          errorType: null,
          inputBytes: 0,
          outputBytes: 0,
        };

        repo.insertToolCall(toolCall);
      }
    }
    prevEvent = event;
  }

  // Insert raw events
  for (const event of events) {
    repo.insertEvent({
      eventId: event.eventId,
      sessionId: discovered.sessionId,
      agentId: discovered.sessionId,
      ts: event.ts,
      rawType: event.rawType,
      normType: event.normType,
      rawLineNo: event.rawLineNo,
      rawJson: event.rawJson,
    });
  }

  return session;
}

function inferSpanType(event: NormalizedEvent): Span["spanType"] {
  if (event.normType === "tool_use") {
    return event.mcpServer ? "tool_call_mcp" : "tool_call_builtin";
  }
  if (event.normType === "thinking") {
    return "agent_llm_active";
  }
  if (event.normType === "text_response") {
    return "agent_llm_active";
  }
  return "unknown_gap";
}

export async function ingestAll(
  db: Database,
  path: string,
  options: IngestOptions = {}
): Promise<Session[]> {
  createSchema(db);
  const discovered = await discoverSessions(path);
  const sessions: Session[] = [];

  for (const disc of discovered) {
    const session = await ingestSession(db, disc);
    sessions.push(session);
    console.log(`Ingested session ${session.sessionId} (${session.durationMs}ms, $${session.estimatedCostUsd.toFixed(4)})`);
  }

  return sessions;
}
