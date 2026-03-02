import { describe, it, expect, beforeEach, afterEach, test } from "bun:test";
import { Database } from "bun:sqlite";
import { createSchema } from "./schema.js";
import { Repository } from "./repository.js";
import type { Session, Agent, Span } from "@cray/shared";

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

  it("should compute proportional time attribution for overlapping spans", () => {
    // Setup: session with overlapping LLM and tool spans
    // Timeline:
    //   LLM:  [0---------30000]  (30s)
    //   Tool:      [10000--20000] (10s, overlaps with LLM)
    // Expected proportional attribution:
    //   0-10s: LLM only → LLM gets 10s
    //   10-20s: LLM + Tool → each gets 5s
    //   20-30s: LLM only → LLM gets 10s
    //   Total: LLM=25s (83.3%), Tool=5s (16.7%), Sum=100%

    repo.insertSession({
      sessionId: "sess1",
      projectPath: "/test",
      startTs: 0,
      endTs: 30000,
      durationMs: 30000,
      totalInputTokens: 100,
      totalOutputTokens: 50,
      totalCacheReadTokens: 0,
      totalCacheWriteTokens: 0,
      estimatedCostUsd: 0.01,
    });

    repo.insertAgent({
      agentId: "agent1",
      sessionId: "sess1",
      parentAgentId: null,
      kind: "main",
      transcriptPath: "/test/sess1.jsonl",
      startTs: 0,
      endTs: 30000,
      linkConfidence: 1.0,
      totalInputTokens: 100,
      totalOutputTokens: 50,
      estimatedCostUsd: 0.01,
    });

    // LLM span: 0-30s
    repo.insertSpan({
      spanId: "span-llm",
      sessionId: "sess1",
      agentId: "agent1",
      parentSpanId: null,
      spanType: "agent_llm_active",
      startTs: 0,
      endTs: 30000,
      durationMs: 30000,
      status: "success",
      inputTokens: 100,
      outputTokens: 50,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      model: "claude-sonnet",
    });

    // Tool span: 10-20s (overlaps with LLM)
    repo.insertSpan({
      spanId: "span-tool",
      sessionId: "sess1",
      agentId: "agent1",
      parentSpanId: null,
      spanType: "tool_call_builtin",
      startTs: 10000,
      endTs: 20000,
      durationMs: 10000,
      status: "success",
      inputTokens: 0,
      outputTokens: 0,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      model: null,
    });

    repo.insertToolCall({
      toolCallId: "tc1",
      spanId: "span-tool",
      sessionId: "sess1",
      agentId: "agent1",
      toolFamily: "builtin",
      toolName: "Read",
      mcpServer: null,
      status: "success",
      errorType: null,
      inputBytes: 0,
      outputBytes: 0,
    });

    const aggregate = repo.getAggregate(["sess1"]);

    // Should have 2 entries: LLM and Tool
    expect(aggregate.timeBreakdown).toHaveLength(2);

    // Sum of percentages should be ~100% (proportional attribution)
    const totalPct = aggregate.timeBreakdown.reduce((sum, b) => sum + b.pctOfSession, 0);
    expect(totalPct).toBeCloseTo(100, 0);

    // Find LLM and Tool entries
    const llmEntry = aggregate.timeBreakdown.find((b) => b.type === "llm");
    const toolEntry = aggregate.timeBreakdown.find((b) => b.type === "builtin");

    expect(llmEntry).toBeDefined();
    expect(toolEntry).toBeDefined();

    // LLM should have ~83.3% (25s out of 30s)
    expect(llmEntry!.pctOfSession).toBeCloseTo(83.3, 0);

    // Tool should have ~16.7% (5s out of 30s)
    expect(toolEntry!.pctOfSession).toBeCloseTo(16.7, 0);

    // wallClockMs is now proportionally attributed (sums to total)
    expect(llmEntry!.wallClockMs).toBeCloseTo(25000, -2); // ~25s
    expect(toolEntry!.wallClockMs).toBeCloseTo(5000, -2);  // ~5s

    // Sum of wallClockMs should equal total duration
    const totalWallClock = aggregate.timeBreakdown.reduce((sum, b) => sum + b.wallClockMs, 0);
    expect(totalWallClock).toBeCloseTo(30000, -2);
  });
});

describe("Repository.getMessages", () => {
  let db: Database;
  let repo: Repository;

  beforeEach(() => {
    db = new Database(":memory:");
    createSchema(db);
    repo = new Repository(db);

    // Insert test session
    db.run(`INSERT INTO sessions (session_id, project_path, start_ts, end_ts, duration_ms,
      total_input_tokens, total_output_tokens, total_cache_read_tokens,
      total_cache_write_tokens, estimated_cost_usd, first_message)
      VALUES ('sess1', '/test', 1000, 5000, 4000, 100, 50, 0, 0, 0.01, 'hello')`);

    // Insert test agent
    db.run(`INSERT INTO agents (agent_id, session_id, parent_agent_id, kind, transcript_path,
      start_ts, end_ts, link_confidence, total_input_tokens, total_output_tokens, estimated_cost_usd)
      VALUES ('agent1', 'sess1', NULL, 'main', '/test/transcript.jsonl', 1000, 5000, 1.0, 100, 50, 0.01)`);

    // Insert test events
    db.run(`INSERT INTO events (event_id, session_id, agent_id, ts, raw_type, norm_type, raw_line_no, raw_json)
      VALUES ('evt1', 'sess1', 'agent1', 1000, 'user', 'user_message', 1,
      '{"type":"user","message":{"role":"user","content":[{"type":"text","text":"Hello world"}]}}')`);

    db.run(`INSERT INTO events (event_id, session_id, agent_id, ts, raw_type, norm_type, raw_line_no, raw_json)
      VALUES ('evt2', 'sess1', 'agent1', 2000, 'assistant', 'text_response', 2,
      '{"type":"assistant","message":{"role":"assistant","content":[{"type":"text","text":"Hi there!"}]}}')`);
  });

  test("returns messages for session", () => {
    const result = repo.getMessages(["sess1"]);

    expect(result.messages).toHaveLength(2);
    expect(result.messages[0].role).toBe("user");
    expect(result.messages[0].content[0]).toEqual({ type: "text", text: "Hello world" });
    expect(result.messages[1].role).toBe("assistant");
    expect(result.agents).toHaveLength(1);
    expect(result.agents[0].kind).toBe("main");
  });

  test("filters by time range", () => {
    const result = repo.getMessages(["sess1"], 1500, 2500);

    expect(result.messages).toHaveLength(1);
    expect(result.messages[0].role).toBe("assistant");
  });
});
