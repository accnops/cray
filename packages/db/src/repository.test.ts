import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { Database } from "bun:sqlite";
import { createSchema } from "./schema.js";
import { Repository } from "./repository.js";
import type { Session, Agent, Span } from "@ccray/shared";

describe("Repository", () => {
  let db: Database;
  let repo: Repository;

  beforeEach(() => {
    db = new Database(":memory:");
    createSchema(db);
    repo = new Repository(db);
  });

  afterEach(() => {
    db.close();
  });

  it("should insert and retrieve a session", () => {
    const session: Session = {
      sessionId: "sess1",
      projectPath: "/test/project",
      startTs: 1000,
      endTs: 2000,
      durationMs: 1000,
      totalInputTokens: 100,
      totalOutputTokens: 50,
      totalCacheReadTokens: 200,
      totalCacheWriteTokens: 10,
      estimatedCostUsd: 0.01,
    };

    repo.insertSession(session);
    const retrieved = repo.getSession("sess1");

    expect(retrieved).not.toBeNull();
    expect(retrieved?.sessionId).toBe("sess1");
    expect(retrieved?.totalInputTokens).toBe(100);
  });

  it("should list all sessions", () => {
    repo.insertSession({
      sessionId: "sess1",
      projectPath: "/test",
      startTs: 1000,
      endTs: 2000,
      durationMs: 1000,
      totalInputTokens: 0,
      totalOutputTokens: 0,
      totalCacheReadTokens: 0,
      totalCacheWriteTokens: 0,
      estimatedCostUsd: 0,
    });
    repo.insertSession({
      sessionId: "sess2",
      projectPath: "/test",
      startTs: 3000,
      endTs: 4000,
      durationMs: 1000,
      totalInputTokens: 0,
      totalOutputTokens: 0,
      totalCacheReadTokens: 0,
      totalCacheWriteTokens: 0,
      estimatedCostUsd: 0,
    });

    const sessions = repo.listSessions();

    expect(sessions).toHaveLength(2);
  });

  it("should compute tool stats", () => {
    // Setup: session, agent, span, tool_call
    repo.insertSession({
      sessionId: "sess1",
      projectPath: "/test",
      startTs: 0,
      endTs: 10000,
      durationMs: 10000,
      totalInputTokens: 0,
      totalOutputTokens: 0,
      totalCacheReadTokens: 0,
      totalCacheWriteTokens: 0,
      estimatedCostUsd: 0,
    });

    repo.insertAgent({
      agentId: "agent1",
      sessionId: "sess1",
      parentAgentId: null,
      kind: "main",
      transcriptPath: "/test/sess1.jsonl",
      startTs: 0,
      endTs: 10000,
      linkConfidence: 1.0,
      totalInputTokens: 0,
      totalOutputTokens: 0,
      estimatedCostUsd: 0,
    });

    repo.insertSpan({
      spanId: "span1",
      sessionId: "sess1",
      agentId: "agent1",
      parentSpanId: null,
      spanType: "tool_call_builtin",
      startTs: 0,
      endTs: 100,
      durationMs: 100,
      status: "success",
      inputTokens: 0,
      outputTokens: 0,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      model: null,
    });

    repo.insertToolCall({
      toolCallId: "tc1",
      spanId: "span1",
      sessionId: "sess1",
      agentId: "agent1",
      toolFamily: "builtin",
      toolName: "Read",
      mcpServer: null,
      status: "success",
      errorType: null,
      inputBytes: 50,
      outputBytes: 1000,
    });

    const stats = repo.getToolStats("sess1");

    expect(stats).toHaveLength(1);
    expect(stats[0].toolName).toBe("Read");
    expect(stats[0].callCount).toBe(1);
  });
});
