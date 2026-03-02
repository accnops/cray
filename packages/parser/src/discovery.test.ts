import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import { mkdtemp, rm, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { discoverSessions, discoverProjects } from "./discovery.js";

describe("discoverSessions", () => {
  let testDir: string;

  beforeAll(async () => {
    testDir = await mkdtemp(join(tmpdir(), "cray-test-"));

    // Create fake session files
    await writeFile(join(testDir, "abc123.jsonl"), "{}");
    await writeFile(join(testDir, "def456.jsonl"), "{}");
    await mkdir(join(testDir, "subagents"));
    await writeFile(join(testDir, "subagents", "agent-1.jsonl"), "{}");
  });

  afterAll(async () => {
    await rm(testDir, { recursive: true });
  });

  it("should find all JSONL files in a session directory", async () => {
    const sessions = await discoverSessions(testDir);

    expect(sessions).toHaveLength(2);
    expect(sessions.some(s => s.sessionId === "abc123")).toBe(true);
    expect(sessions.some(s => s.sessionId === "def456")).toBe(true);
  });

  it("should find subagent files", async () => {
    const sessions = await discoverSessions(testDir);
    const session = sessions.find(s => s.sessionId === "abc123");

    expect(session?.subagentPaths).toHaveLength(1);
    expect(session?.subagentPaths[0]).toContain("agent-1.jsonl");
  });
});
