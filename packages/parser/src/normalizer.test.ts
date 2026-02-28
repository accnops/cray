import { describe, it, expect } from "bun:test";
import { normalizeEvent, extractTokenUsage } from "./normalizer.js";

describe("normalizeEvent", () => {
  it("should normalize user event", () => {
    const raw = {
      type: "user",
      timestamp: "2026-01-01T00:00:00.000Z",
      uuid: "abc123",
      sessionId: "sess1",
      message: { role: "user", content: "hello" },
    };

    const normalized = normalizeEvent(raw, 1);

    expect(normalized.rawType).toBe("user");
    expect(normalized.normType).toBe("user_message");
    expect(normalized.ts).toBe(new Date("2026-01-01T00:00:00.000Z").getTime());
    expect(normalized.rawLineNo).toBe(1);
  });

  it("should normalize assistant event with tool use", () => {
    const raw = {
      type: "assistant",
      timestamp: "2026-01-01T00:00:01.000Z",
      uuid: "def456",
      sessionId: "sess1",
      message: {
        role: "assistant",
        model: "claude-opus-4-5-20251101",
        content: [{ type: "tool_use", name: "Read", id: "tool1" }],
        usage: { input_tokens: 100, output_tokens: 50 },
      },
    };

    const normalized = normalizeEvent(raw, 2);

    expect(normalized.normType).toBe("tool_use");
    expect(normalized.ts).toBe(new Date("2026-01-01T00:00:01.000Z").getTime());
  });
});

describe("extractTokenUsage", () => {
  it("should extract token usage from message", () => {
    const message = {
      usage: {
        input_tokens: 100,
        output_tokens: 50,
        cache_creation_input_tokens: 200,
        cache_read_input_tokens: 300,
      },
    };

    const usage = extractTokenUsage(message);

    expect(usage.inputTokens).toBe(100);
    expect(usage.outputTokens).toBe(50);
    expect(usage.cacheCreationInputTokens).toBe(200);
    expect(usage.cacheReadInputTokens).toBe(300);
  });

  it("should return zeros for missing usage", () => {
    const usage = extractTokenUsage({});

    expect(usage.inputTokens).toBe(0);
    expect(usage.outputTokens).toBe(0);
  });
});
