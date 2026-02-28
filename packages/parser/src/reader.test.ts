import { describe, it, expect } from "bun:test";
import { readJsonlLines } from "./reader.js";

describe("readJsonlLines", () => {
  it("should parse valid JSONL lines", async () => {
    const content = `{"type":"user","timestamp":"2026-01-01T00:00:00Z"}
{"type":"assistant","timestamp":"2026-01-01T00:00:01Z"}`;

    const file = new Blob([content]);
    const lines: unknown[] = [];

    for await (const line of readJsonlLines(file.stream())) {
      lines.push(line);
    }

    expect(lines).toHaveLength(2);
    expect(lines[0]).toEqual({ type: "user", timestamp: "2026-01-01T00:00:00Z" });
    expect(lines[1]).toEqual({ type: "assistant", timestamp: "2026-01-01T00:00:01Z" });
  });

  it("should skip malformed lines and continue", async () => {
    const content = `{"type":"user"}
invalid json here
{"type":"assistant"}`;

    const file = new Blob([content]);
    const lines: unknown[] = [];

    for await (const line of readJsonlLines(file.stream())) {
      lines.push(line);
    }

    expect(lines).toHaveLength(2);
  });
});
