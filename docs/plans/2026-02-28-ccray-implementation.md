# ccray Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build a CLI tool that parses Claude Code JSONL transcripts and provides a browser-based debugger UI with session explorer, trace timeline, tool profiler, and token cost tracking.

**Architecture:** Bun monorepo with 6 packages: shared (types/schemas), parser (JSONL→normalized events), db (SQLite layer), server (HTTP API), cli (commands), web (React UI). Parser streams JSONL, normalizes to spans, stores in SQLite. Server queries SQLite and serves to React frontend. CLI orchestrates the pipeline.

**Tech Stack:** Bun, TypeScript, Zod, SQLite (bun:sqlite), Hono, React, Vite, PixiJS, d3-scale, TanStack Table, ECharts

---

## Phase 1: Project Foundation

### Task 1: Scaffold Monorepo

**Files:**
- Create: `package.json`
- Create: `pnpm-workspace.yaml`
- Create: `tsconfig.base.json`
- Create: `.gitignore`
- Create: `biome.json`

**Step 1: Initialize pnpm workspace**

```bash
pnpm init
```

**Step 2: Create workspace config**

`pnpm-workspace.yaml`:
```yaml
packages:
  - "packages/*"
```

**Step 3: Create root package.json**

`package.json`:
```json
{
  "name": "ccray",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "pnpm -r dev",
    "build": "pnpm -r build",
    "test": "pnpm -r test",
    "lint": "biome check .",
    "format": "biome format --write ."
  },
  "devDependencies": {
    "@biomejs/biome": "^1.9.0",
    "typescript": "^5.7.0"
  }
}
```

**Step 4: Create base tsconfig**

`tsconfig.base.json`:
```json
{
  "compilerOptions": {
    "target": "ESNext",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "declaration": true,
    "declarationMap": true,
    "sourceMap": true,
    "composite": true,
    "outDir": "dist",
    "rootDir": "src"
  }
}
```

**Step 5: Create .gitignore**

`.gitignore`:
```
node_modules/
dist/
.cache/
*.db
*.db-journal
.DS_Store
```

**Step 6: Create biome config**

`biome.json`:
```json
{
  "$schema": "https://biomejs.dev/schemas/1.9.0/schema.json",
  "organizeImports": { "enabled": true },
  "linter": { "enabled": true },
  "formatter": {
    "enabled": true,
    "indentStyle": "space",
    "indentWidth": 2
  }
}
```

**Step 7: Create package directories**

```bash
mkdir -p packages/{shared,parser,db,server,cli,web}/src
```

**Step 8: Install dependencies and commit**

```bash
pnpm install
git add -A && git commit -m "chore: scaffold pnpm monorepo"
```

---

### Task 2: Setup Shared Package

**Files:**
- Create: `packages/shared/package.json`
- Create: `packages/shared/tsconfig.json`
- Create: `packages/shared/src/index.ts`
- Create: `packages/shared/src/types.ts`
- Create: `packages/shared/src/schemas.ts`
- Create: `packages/shared/src/pricing.ts`

**Step 1: Create package.json**

`packages/shared/package.json`:
```json
{
  "name": "@ccray/shared",
  "version": "0.1.0",
  "type": "module",
  "main": "dist/index.js",
  "types": "dist/index.d.ts",
  "scripts": {
    "build": "tsc",
    "dev": "tsc --watch"
  },
  "dependencies": {
    "zod": "^3.24.0"
  }
}
```

**Step 2: Create tsconfig.json**

`packages/shared/tsconfig.json`:
```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "outDir": "dist",
    "rootDir": "src"
  },
  "include": ["src"]
}
```

**Step 3: Create types.ts**

`packages/shared/src/types.ts`:
```typescript
export type SpanType =
  | "agent_llm_active"
  | "tool_call_builtin"
  | "tool_call_mcp"
  | "hook_pre"
  | "hook_post"
  | "permission_wait"
  | "subagent_spawn"
  | "compaction"
  | "unknown_gap";

export type AgentKind = "main" | "subagent";

export type ToolFamily = "builtin" | "mcp";

export type SpanStatus = "success" | "error" | "unknown";

export interface Session {
  sessionId: string;
  projectPath: string;
  startTs: number;
  endTs: number;
  durationMs: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  totalCacheReadTokens: number;
  totalCacheWriteTokens: number;
  estimatedCostUsd: number;
}

export interface Agent {
  agentId: string;
  sessionId: string;
  parentAgentId: string | null;
  kind: AgentKind;
  transcriptPath: string;
  startTs: number;
  endTs: number;
  linkConfidence: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  estimatedCostUsd: number;
}

export interface Span {
  spanId: string;
  sessionId: string;
  agentId: string;
  parentSpanId: string | null;
  spanType: SpanType;
  startTs: number;
  endTs: number;
  durationMs: number;
  status: SpanStatus;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  model: string | null;
}

export interface ToolCall {
  toolCallId: string;
  spanId: string;
  sessionId: string;
  agentId: string;
  toolFamily: ToolFamily;
  toolName: string;
  mcpServer: string | null;
  status: SpanStatus;
  errorType: string | null;
  inputBytes: number;
  outputBytes: number;
}

export interface RawEvent {
  eventId: string;
  sessionId: string;
  agentId: string;
  ts: number;
  rawType: string;
  normType: string;
  rawLineNo: number;
  rawJson: string;
}

export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
  cacheCreationInputTokens: number;
  cacheReadInputTokens: number;
}
```

**Step 4: Create schemas.ts**

`packages/shared/src/schemas.ts`:
```typescript
import { z } from "zod";

export const RawEventSchema = z.object({
  type: z.string(),
  timestamp: z.string(),
  uuid: z.string().optional(),
  parentUuid: z.string().optional(),
  sessionId: z.string().optional(),
  message: z.any().optional(),
  toolUseResult: z.any().optional(),
}).passthrough();

export const UsageSchema = z.object({
  input_tokens: z.number().optional(),
  output_tokens: z.number().optional(),
  cache_creation_input_tokens: z.number().optional(),
  cache_read_input_tokens: z.number().optional(),
}).passthrough();

export const AssistantMessageSchema = z.object({
  model: z.string().optional(),
  id: z.string().optional(),
  role: z.literal("assistant"),
  content: z.array(z.any()),
  usage: UsageSchema.optional(),
}).passthrough();

export type RawEventInput = z.infer<typeof RawEventSchema>;
export type UsageInput = z.infer<typeof UsageSchema>;
export type AssistantMessageInput = z.infer<typeof AssistantMessageSchema>;
```

**Step 5: Create pricing.ts**

`packages/shared/src/pricing.ts`:
```typescript
// Pricing per million tokens (as of 2026)
export const MODEL_PRICING: Record<string, { input: number; output: number }> = {
  "claude-opus-4-5-20251101": { input: 15.0, output: 75.0 },
  "claude-sonnet-4-5-20250929": { input: 3.0, output: 15.0 },
  "claude-haiku-4-5-20251001": { input: 0.8, output: 4.0 },
  // Fallback for unknown models
  default: { input: 3.0, output: 15.0 },
};

// Cache pricing multipliers
export const CACHE_READ_MULTIPLIER = 0.1; // 10% of input cost
export const CACHE_WRITE_MULTIPLIER = 1.25; // 125% of input cost

export function estimateCost(
  model: string | null,
  inputTokens: number,
  outputTokens: number,
  cacheReadTokens: number,
  cacheWriteTokens: number
): number {
  const pricing = MODEL_PRICING[model ?? ""] ?? MODEL_PRICING.default;
  const inputCostPerToken = pricing.input / 1_000_000;
  const outputCostPerToken = pricing.output / 1_000_000;

  const inputCost = inputTokens * inputCostPerToken;
  const outputCost = outputTokens * outputCostPerToken;
  const cacheReadCost = cacheReadTokens * inputCostPerToken * CACHE_READ_MULTIPLIER;
  const cacheWriteCost = cacheWriteTokens * inputCostPerToken * CACHE_WRITE_MULTIPLIER;

  return inputCost + outputCost + cacheReadCost + cacheWriteCost;
}
```

**Step 6: Create index.ts**

`packages/shared/src/index.ts`:
```typescript
export * from "./types.js";
export * from "./schemas.js";
export * from "./pricing.js";
```

**Step 7: Install dependencies and commit**

```bash
cd packages/shared && pnpm install && pnpm build
cd ../..
git add -A && git commit -m "feat(shared): add types, schemas, and pricing"
```

---

### Task 3: Setup Parser Package - Basic Structure

**Files:**
- Create: `packages/parser/package.json`
- Create: `packages/parser/tsconfig.json`
- Create: `packages/parser/src/index.ts`
- Create: `packages/parser/src/reader.ts`
- Create: `packages/parser/src/reader.test.ts`

**Step 1: Create package.json**

`packages/parser/package.json`:
```json
{
  "name": "@ccray/parser",
  "version": "0.1.0",
  "type": "module",
  "main": "dist/index.js",
  "types": "dist/index.d.ts",
  "scripts": {
    "build": "tsc",
    "dev": "tsc --watch",
    "test": "bun test"
  },
  "dependencies": {
    "@ccray/shared": "workspace:*"
  }
}
```

**Step 2: Create tsconfig.json**

`packages/parser/tsconfig.json`:
```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "outDir": "dist",
    "rootDir": "src"
  },
  "include": ["src"],
  "references": [{ "path": "../shared" }]
}
```

**Step 3: Write failing test for JSONL reader**

`packages/parser/src/reader.test.ts`:
```typescript
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
```

**Step 4: Run test to verify it fails**

```bash
cd packages/parser && bun test
```

Expected: FAIL with "Cannot find module './reader.js'"

**Step 5: Implement reader.ts**

`packages/parser/src/reader.ts`:
```typescript
export async function* readJsonlLines(
  stream: ReadableStream<Uint8Array>
): AsyncGenerator<unknown, void, undefined> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  try {
    while (true) {
      const { done, value } = await reader.read();

      if (done) {
        // Process remaining buffer
        if (buffer.trim()) {
          try {
            yield JSON.parse(buffer);
          } catch {
            // Skip malformed line
          }
        }
        break;
      }

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";

      for (const line of lines) {
        if (line.trim()) {
          try {
            yield JSON.parse(line);
          } catch {
            // Skip malformed line
          }
        }
      }
    }
  } finally {
    reader.releaseLock();
  }
}
```

**Step 6: Run test to verify it passes**

```bash
cd packages/parser && bun test
```

Expected: PASS

**Step 7: Create index.ts**

`packages/parser/src/index.ts`:
```typescript
export * from "./reader.js";
```

**Step 8: Commit**

```bash
cd ../..
git add -A && git commit -m "feat(parser): add streaming JSONL reader"
```

---

### Task 4: Parser - Session Discovery

**Files:**
- Create: `packages/parser/src/discovery.ts`
- Create: `packages/parser/src/discovery.test.ts`

**Step 1: Write failing test**

`packages/parser/src/discovery.test.ts`:
```typescript
import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import { mkdtemp, rm, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { discoverSessions, discoverProjects } from "./discovery.js";

describe("discoverSessions", () => {
  let testDir: string;

  beforeAll(async () => {
    testDir = await mkdtemp(join(tmpdir(), "ccray-test-"));

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
```

**Step 2: Run test to verify it fails**

```bash
cd packages/parser && bun test src/discovery.test.ts
```

Expected: FAIL

**Step 3: Implement discovery.ts**

`packages/parser/src/discovery.ts`:
```typescript
import { readdir, stat } from "node:fs/promises";
import { join, basename } from "node:path";

export interface DiscoveredSession {
  sessionId: string;
  mainPath: string;
  subagentPaths: string[];
  projectPath: string;
}

export interface DiscoveredProject {
  projectPath: string;
  projectName: string;
  sessions: DiscoveredSession[];
}

export async function discoverSessions(dir: string): Promise<DiscoveredSession[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  const sessions: DiscoveredSession[] = [];

  for (const entry of entries) {
    if (entry.isFile() && entry.name.endsWith(".jsonl")) {
      const sessionId = entry.name.replace(".jsonl", "");
      const mainPath = join(dir, entry.name);

      // Look for subagent files
      const subagentDir = join(dir, "subagents");
      let subagentPaths: string[] = [];

      try {
        const subagentEntries = await readdir(subagentDir);
        subagentPaths = subagentEntries
          .filter(f => f.endsWith(".jsonl"))
          .map(f => join(subagentDir, f));
      } catch {
        // No subagents directory
      }

      sessions.push({
        sessionId,
        mainPath,
        subagentPaths,
        projectPath: dir,
      });
    }
  }

  return sessions;
}

export async function discoverProjects(claudeDir: string): Promise<DiscoveredProject[]> {
  const projectsDir = join(claudeDir, "projects");
  const projects: DiscoveredProject[] = [];

  try {
    const entries = await readdir(projectsDir, { withFileTypes: true });

    for (const entry of entries) {
      if (entry.isDirectory() && !entry.name.startsWith(".")) {
        const projectPath = join(projectsDir, entry.name);
        const sessions = await discoverSessions(projectPath);

        if (sessions.length > 0) {
          projects.push({
            projectPath,
            projectName: entry.name,
            sessions,
          });
        }
      }
    }
  } catch {
    // No projects directory
  }

  return projects;
}
```

**Step 4: Run test to verify it passes**

```bash
cd packages/parser && bun test src/discovery.test.ts
```

Expected: PASS

**Step 5: Update index.ts**

`packages/parser/src/index.ts`:
```typescript
export * from "./reader.js";
export * from "./discovery.js";
```

**Step 6: Commit**

```bash
cd ../..
git add -A && git commit -m "feat(parser): add session and project discovery"
```

---

### Task 5: Parser - Event Normalization

**Files:**
- Create: `packages/parser/src/normalizer.ts`
- Create: `packages/parser/src/normalizer.test.ts`

**Step 1: Write failing test**

`packages/parser/src/normalizer.test.ts`:
```typescript
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
```

**Step 2: Run test to verify it fails**

```bash
cd packages/parser && bun test src/normalizer.test.ts
```

Expected: FAIL

**Step 3: Implement normalizer.ts**

`packages/parser/src/normalizer.ts`:
```typescript
import type { TokenUsage } from "@ccray/shared";
import { RawEventSchema } from "@ccray/shared";

export interface NormalizedEvent {
  eventId: string;
  sessionId: string;
  agentId: string;
  ts: number;
  rawType: string;
  normType: string;
  rawLineNo: number;
  rawJson: string;
  model?: string;
  tokenUsage?: TokenUsage;
  toolName?: string;
  toolId?: string;
  mcpServer?: string;
}

export function normalizeEvent(raw: unknown, lineNo: number): NormalizedEvent {
  const parsed = RawEventSchema.safeParse(raw);

  if (!parsed.success) {
    return {
      eventId: crypto.randomUUID(),
      sessionId: "",
      agentId: "",
      ts: Date.now(),
      rawType: "unknown",
      normType: "unknown",
      rawLineNo: lineNo,
      rawJson: JSON.stringify(raw),
    };
  }

  const event = parsed.data;
  const ts = new Date(event.timestamp).getTime();
  const rawJson = JSON.stringify(raw);

  let normType = "unknown";
  let model: string | undefined;
  let tokenUsage: TokenUsage | undefined;
  let toolName: string | undefined;
  let toolId: string | undefined;
  let mcpServer: string | undefined;

  if (event.type === "user") {
    normType = "user_message";
  } else if (event.type === "assistant" && event.message) {
    const message = event.message;
    model = message.model;
    tokenUsage = extractTokenUsage(message);

    const content = Array.isArray(message.content) ? message.content : [];
    const hasToolUse = content.some((c: { type?: string }) => c.type === "tool_use");
    const hasThinking = content.some((c: { type?: string }) => c.type === "thinking");
    const hasText = content.some((c: { type?: string }) => c.type === "text");

    if (hasToolUse) {
      normType = "tool_use";
      const toolUseContent = content.find((c: { type?: string }) => c.type === "tool_use");
      if (toolUseContent) {
        toolName = toolUseContent.name;
        toolId = toolUseContent.id;

        // Parse MCP tool names: mcp__server__tool
        if (toolName?.startsWith("mcp__")) {
          const parts = toolName.split("__");
          if (parts.length >= 3) {
            mcpServer = parts[1];
          }
        }
      }
    } else if (hasThinking) {
      normType = "thinking";
    } else if (hasText) {
      normType = "text_response";
    }
  }

  return {
    eventId: event.uuid ?? crypto.randomUUID(),
    sessionId: event.sessionId ?? "",
    agentId: event.sessionId ?? "", // Will be refined in span inference
    ts,
    rawType: event.type,
    normType,
    rawLineNo: lineNo,
    rawJson,
    model,
    tokenUsage,
    toolName,
    toolId,
    mcpServer,
  };
}

export function extractTokenUsage(message: Record<string, unknown>): TokenUsage {
  const usage = (message.usage ?? {}) as Record<string, number>;

  return {
    inputTokens: usage.input_tokens ?? 0,
    outputTokens: usage.output_tokens ?? 0,
    cacheCreationInputTokens: usage.cache_creation_input_tokens ?? 0,
    cacheReadInputTokens: usage.cache_read_input_tokens ?? 0,
  };
}
```

**Step 4: Run test to verify it passes**

```bash
cd packages/parser && bun test src/normalizer.test.ts
```

Expected: PASS

**Step 5: Update index.ts**

`packages/parser/src/index.ts`:
```typescript
export * from "./reader.js";
export * from "./discovery.js";
export * from "./normalizer.js";
```

**Step 6: Commit**

```bash
cd ../..
git add -A && git commit -m "feat(parser): add event normalization with token extraction"
```

---

## Phase 2: Database Layer

### Task 6: Setup DB Package with Schema

**Files:**
- Create: `packages/db/package.json`
- Create: `packages/db/tsconfig.json`
- Create: `packages/db/src/index.ts`
- Create: `packages/db/src/schema.ts`
- Create: `packages/db/src/schema.test.ts`

**Step 1: Create package.json**

`packages/db/package.json`:
```json
{
  "name": "@ccray/db",
  "version": "0.1.0",
  "type": "module",
  "main": "dist/index.js",
  "types": "dist/index.d.ts",
  "scripts": {
    "build": "tsc",
    "dev": "tsc --watch",
    "test": "bun test"
  },
  "dependencies": {
    "@ccray/shared": "workspace:*"
  }
}
```

**Step 2: Create tsconfig.json**

`packages/db/tsconfig.json`:
```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "outDir": "dist",
    "rootDir": "src"
  },
  "include": ["src"],
  "references": [{ "path": "../shared" }]
}
```

**Step 3: Write failing test**

`packages/db/src/schema.test.ts`:
```typescript
import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { Database } from "bun:sqlite";
import { createSchema, SCHEMA_VERSION } from "./schema.js";

describe("createSchema", () => {
  let db: Database;

  beforeEach(() => {
    db = new Database(":memory:");
  });

  afterEach(() => {
    db.close();
  });

  it("should create all required tables", () => {
    createSchema(db);

    const tables = db
      .query("SELECT name FROM sqlite_master WHERE type='table'")
      .all() as { name: string }[];

    const tableNames = tables.map(t => t.name);

    expect(tableNames).toContain("sessions");
    expect(tableNames).toContain("agents");
    expect(tableNames).toContain("spans");
    expect(tableNames).toContain("tool_calls");
    expect(tableNames).toContain("events");
    expect(tableNames).toContain("schema_version");
  });

  it("should set schema version", () => {
    createSchema(db);

    const row = db.query("SELECT version FROM schema_version").get() as { version: number };

    expect(row.version).toBe(SCHEMA_VERSION);
  });
});
```

**Step 4: Run test to verify it fails**

```bash
cd packages/db && bun test
```

Expected: FAIL

**Step 5: Implement schema.ts**

`packages/db/src/schema.ts`:
```typescript
import { Database } from "bun:sqlite";

export const SCHEMA_VERSION = 1;

export function createSchema(db: Database): void {
  db.run("PRAGMA journal_mode = WAL");
  db.run("PRAGMA foreign_keys = ON");

  db.run(`
    CREATE TABLE IF NOT EXISTS schema_version (
      version INTEGER PRIMARY KEY
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS sessions (
      session_id TEXT PRIMARY KEY,
      project_path TEXT NOT NULL,
      start_ts INTEGER NOT NULL,
      end_ts INTEGER NOT NULL,
      duration_ms INTEGER NOT NULL,
      total_input_tokens INTEGER DEFAULT 0,
      total_output_tokens INTEGER DEFAULT 0,
      total_cache_read_tokens INTEGER DEFAULT 0,
      total_cache_write_tokens INTEGER DEFAULT 0,
      estimated_cost_usd REAL DEFAULT 0
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS agents (
      agent_id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL REFERENCES sessions(session_id),
      parent_agent_id TEXT,
      kind TEXT NOT NULL CHECK (kind IN ('main', 'subagent')),
      transcript_path TEXT NOT NULL,
      start_ts INTEGER NOT NULL,
      end_ts INTEGER NOT NULL,
      link_confidence REAL DEFAULT 1.0,
      total_input_tokens INTEGER DEFAULT 0,
      total_output_tokens INTEGER DEFAULT 0,
      estimated_cost_usd REAL DEFAULT 0
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS spans (
      span_id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL REFERENCES sessions(session_id),
      agent_id TEXT NOT NULL REFERENCES agents(agent_id),
      parent_span_id TEXT,
      span_type TEXT NOT NULL,
      start_ts INTEGER NOT NULL,
      end_ts INTEGER NOT NULL,
      duration_ms INTEGER NOT NULL,
      status TEXT NOT NULL CHECK (status IN ('success', 'error', 'unknown')),
      input_tokens INTEGER DEFAULT 0,
      output_tokens INTEGER DEFAULT 0,
      cache_read_tokens INTEGER DEFAULT 0,
      cache_write_tokens INTEGER DEFAULT 0,
      model TEXT
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS tool_calls (
      tool_call_id TEXT PRIMARY KEY,
      span_id TEXT NOT NULL REFERENCES spans(span_id),
      session_id TEXT NOT NULL REFERENCES sessions(session_id),
      agent_id TEXT NOT NULL REFERENCES agents(agent_id),
      tool_family TEXT NOT NULL CHECK (tool_family IN ('builtin', 'mcp')),
      tool_name TEXT NOT NULL,
      mcp_server TEXT,
      status TEXT NOT NULL CHECK (status IN ('success', 'error', 'unknown')),
      error_type TEXT,
      input_bytes INTEGER DEFAULT 0,
      output_bytes INTEGER DEFAULT 0
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS events (
      event_id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL REFERENCES sessions(session_id),
      agent_id TEXT NOT NULL REFERENCES agents(agent_id),
      ts INTEGER NOT NULL,
      raw_type TEXT NOT NULL,
      norm_type TEXT NOT NULL,
      raw_line_no INTEGER NOT NULL,
      raw_json TEXT NOT NULL
    )
  `);

  // Create indexes
  db.run("CREATE INDEX IF NOT EXISTS idx_spans_session ON spans(session_id)");
  db.run("CREATE INDEX IF NOT EXISTS idx_spans_agent ON spans(agent_id)");
  db.run("CREATE INDEX IF NOT EXISTS idx_spans_ts ON spans(start_ts, end_ts)");
  db.run("CREATE INDEX IF NOT EXISTS idx_tool_calls_session ON tool_calls(session_id)");
  db.run("CREATE INDEX IF NOT EXISTS idx_tool_calls_tool ON tool_calls(tool_name)");
  db.run("CREATE INDEX IF NOT EXISTS idx_events_session ON events(session_id)");
  db.run("CREATE INDEX IF NOT EXISTS idx_events_ts ON events(ts)");

  // Set schema version
  db.run("DELETE FROM schema_version");
  db.run("INSERT INTO schema_version (version) VALUES (?)", [SCHEMA_VERSION]);
}
```

**Step 6: Run test to verify it passes**

```bash
cd packages/db && bun test
```

Expected: PASS

**Step 7: Create index.ts**

`packages/db/src/index.ts`:
```typescript
export * from "./schema.js";
```

**Step 8: Commit**

```bash
cd ../..
git add -A && git commit -m "feat(db): add SQLite schema with all tables and indexes"
```

---

### Task 7: DB - Repository Layer

**Files:**
- Create: `packages/db/src/repository.ts`
- Create: `packages/db/src/repository.test.ts`

**Step 1: Write failing test**

`packages/db/src/repository.test.ts`:
```typescript
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
```

**Step 2: Run test to verify it fails**

```bash
cd packages/db && bun test src/repository.test.ts
```

Expected: FAIL

**Step 3: Implement repository.ts**

`packages/db/src/repository.ts`:
```typescript
import { Database } from "bun:sqlite";
import type { Session, Agent, Span, ToolCall, RawEvent } from "@ccray/shared";

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

export class Repository {
  constructor(private db: Database) {}

  insertSession(session: Session): void {
    this.db.run(
      `INSERT OR REPLACE INTO sessions
       (session_id, project_path, start_ts, end_ts, duration_ms,
        total_input_tokens, total_output_tokens, total_cache_read_tokens,
        total_cache_write_tokens, estimated_cost_usd)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
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
      ]
    );
  }

  getSession(sessionId: string): Session | null {
    const row = this.db.query(
      `SELECT * FROM sessions WHERE session_id = ?`
    ).get(sessionId) as Record<string, unknown> | null;

    if (!row) return null;

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
    };
  }

  listSessions(): Session[] {
    const rows = this.db.query(
      `SELECT * FROM sessions ORDER BY start_ts DESC`
    ).all() as Record<string, unknown>[];

    return rows.map(row => ({
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
    }));
  }

  insertAgent(agent: Agent): void {
    this.db.run(
      `INSERT OR REPLACE INTO agents
       (agent_id, session_id, parent_agent_id, kind, transcript_path,
        start_ts, end_ts, link_confidence, total_input_tokens,
        total_output_tokens, estimated_cost_usd)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
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
        agent.estimatedCostUsd,
      ]
    );
  }

  getAgents(sessionId: string): Agent[] {
    const rows = this.db.query(
      `SELECT * FROM agents WHERE session_id = ? ORDER BY start_ts`
    ).all(sessionId) as Record<string, unknown>[];

    return rows.map(row => ({
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
    }));
  }

  insertSpan(span: Span): void {
    this.db.run(
      `INSERT OR REPLACE INTO spans
       (span_id, session_id, agent_id, parent_span_id, span_type,
        start_ts, end_ts, duration_ms, status, input_tokens, output_tokens,
        cache_read_tokens, cache_write_tokens, model)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
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
        span.model,
      ]
    );
  }

  getSpans(sessionId: string): Span[] {
    const rows = this.db.query(
      `SELECT * FROM spans WHERE session_id = ? ORDER BY start_ts`
    ).all(sessionId) as Record<string, unknown>[];

    return rows.map(row => ({
      spanId: row.span_id as string,
      sessionId: row.session_id as string,
      agentId: row.agent_id as string,
      parentSpanId: row.parent_span_id as string | null,
      spanType: row.span_type as Span["spanType"],
      startTs: row.start_ts as number,
      endTs: row.end_ts as number,
      durationMs: row.duration_ms as number,
      status: row.status as Span["status"],
      inputTokens: row.input_tokens as number,
      outputTokens: row.output_tokens as number,
      cacheReadTokens: row.cache_read_tokens as number,
      cacheWriteTokens: row.cache_write_tokens as number,
      model: row.model as string | null,
    }));
  }

  insertToolCall(toolCall: ToolCall): void {
    this.db.run(
      `INSERT OR REPLACE INTO tool_calls
       (tool_call_id, span_id, session_id, agent_id, tool_family,
        tool_name, mcp_server, status, error_type, input_bytes, output_bytes)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
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
        toolCall.outputBytes,
      ]
    );
  }

  insertEvent(event: RawEvent): void {
    this.db.run(
      `INSERT OR REPLACE INTO events
       (event_id, session_id, agent_id, ts, raw_type, norm_type, raw_line_no, raw_json)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        event.eventId,
        event.sessionId,
        event.agentId,
        event.ts,
        event.rawType,
        event.normType,
        event.rawLineNo,
        event.rawJson,
      ]
    );
  }

  getToolStats(sessionId: string): ToolStats[] {
    const rows = this.db.query(`
      SELECT
        tc.tool_name,
        tc.tool_family,
        tc.mcp_server,
        COUNT(*) as call_count,
        SUM(s.duration_ms) as total_duration_ms,
        AVG(s.duration_ms) as avg_duration_ms,
        MAX(s.duration_ms) as max_duration_ms,
        SUM(CASE WHEN tc.status = 'error' THEN 1 ELSE 0 END) as error_count,
        SUM(tc.input_bytes) as total_input_bytes,
        SUM(tc.output_bytes) as total_output_bytes
      FROM tool_calls tc
      JOIN spans s ON tc.span_id = s.span_id
      WHERE tc.session_id = ?
      GROUP BY tc.tool_name, tc.tool_family, tc.mcp_server
      ORDER BY total_duration_ms DESC
    `).all(sessionId) as Record<string, unknown>[];

    return rows.map(row => {
      const callCount = row.call_count as number;
      const errorCount = row.error_count as number;

      return {
        toolName: row.tool_name as string,
        toolFamily: row.tool_family as string,
        mcpServer: row.mcp_server as string | null,
        callCount,
        totalDurationMs: row.total_duration_ms as number,
        avgDurationMs: row.avg_duration_ms as number,
        p50DurationMs: row.avg_duration_ms as number, // Simplified for now
        p95DurationMs: row.max_duration_ms as number, // Simplified for now
        maxDurationMs: row.max_duration_ms as number,
        errorCount,
        errorRate: callCount > 0 ? errorCount / callCount : 0,
        totalInputBytes: row.total_input_bytes as number,
        totalOutputBytes: row.total_output_bytes as number,
      };
    });
  }
}
```

**Step 4: Run test to verify it passes**

```bash
cd packages/db && bun test src/repository.test.ts
```

Expected: PASS

**Step 5: Update index.ts**

`packages/db/src/index.ts`:
```typescript
export * from "./schema.js";
export * from "./repository.js";
```

**Step 6: Commit**

```bash
cd ../..
git add -A && git commit -m "feat(db): add repository layer for CRUD operations"
```

---

## Phase 3: Server & CLI

### Task 8: Setup Server Package

**Files:**
- Create: `packages/server/package.json`
- Create: `packages/server/tsconfig.json`
- Create: `packages/server/src/index.ts`
- Create: `packages/server/src/routes.ts`
- Create: `packages/server/src/routes.test.ts`

**Step 1: Create package.json**

`packages/server/package.json`:
```json
{
  "name": "@ccray/server",
  "version": "0.1.0",
  "type": "module",
  "main": "dist/index.js",
  "types": "dist/index.d.ts",
  "scripts": {
    "build": "tsc",
    "dev": "tsc --watch",
    "test": "bun test"
  },
  "dependencies": {
    "@ccray/shared": "workspace:*",
    "@ccray/db": "workspace:*",
    "hono": "^4.6.0"
  }
}
```

**Step 2: Create tsconfig.json**

`packages/server/tsconfig.json`:
```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "outDir": "dist",
    "rootDir": "src"
  },
  "include": ["src"],
  "references": [
    { "path": "../shared" },
    { "path": "../db" }
  ]
}
```

**Step 3: Write failing test**

`packages/server/src/routes.test.ts`:
```typescript
import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { Database } from "bun:sqlite";
import { createSchema, Repository } from "@ccray/db";
import { createApp } from "./routes.js";

describe("API routes", () => {
  let db: Database;
  let repo: Repository;
  let app: ReturnType<typeof createApp>;

  beforeEach(() => {
    db = new Database(":memory:");
    createSchema(db);
    repo = new Repository(db);
    app = createApp(repo);

    // Seed test data
    repo.insertSession({
      sessionId: "sess1",
      projectPath: "/test/project",
      startTs: 1000,
      endTs: 2000,
      durationMs: 1000,
      totalInputTokens: 100,
      totalOutputTokens: 50,
      totalCacheReadTokens: 0,
      totalCacheWriteTokens: 0,
      estimatedCostUsd: 0.01,
    });
  });

  afterEach(() => {
    db.close();
  });

  it("GET /api/sessions should return sessions", async () => {
    const res = await app.request("/api/sessions");
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data).toHaveLength(1);
    expect(data[0].sessionId).toBe("sess1");
  });

  it("GET /api/sessions/:id should return single session", async () => {
    const res = await app.request("/api/sessions/sess1");
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.sessionId).toBe("sess1");
  });

  it("GET /api/sessions/:id should return 404 for missing session", async () => {
    const res = await app.request("/api/sessions/nonexistent");

    expect(res.status).toBe(404);
  });
});
```

**Step 4: Run test to verify it fails**

```bash
cd packages/server && pnpm install && bun test
```

Expected: FAIL

**Step 5: Implement routes.ts**

`packages/server/src/routes.ts`:
```typescript
import { Hono } from "hono";
import { cors } from "hono/cors";
import type { Repository } from "@ccray/db";

export function createApp(repo: Repository) {
  const app = new Hono();

  app.use("*", cors());

  // Sessions
  app.get("/api/sessions", (c) => {
    const sessions = repo.listSessions();
    return c.json(sessions);
  });

  app.get("/api/sessions/:id", (c) => {
    const session = repo.getSession(c.req.param("id"));
    if (!session) {
      return c.json({ error: "Session not found" }, 404);
    }
    return c.json(session);
  });

  app.get("/api/sessions/:id/agents", (c) => {
    const agents = repo.getAgents(c.req.param("id"));
    return c.json(agents);
  });

  app.get("/api/sessions/:id/spans", (c) => {
    const spans = repo.getSpans(c.req.param("id"));
    return c.json(spans);
  });

  app.get("/api/sessions/:id/tools", (c) => {
    const stats = repo.getToolStats(c.req.param("id"));
    return c.json(stats);
  });

  return app;
}
```

**Step 6: Run test to verify it passes**

```bash
cd packages/server && bun test
```

Expected: PASS

**Step 7: Create index.ts**

`packages/server/src/index.ts`:
```typescript
export * from "./routes.js";
```

**Step 8: Commit**

```bash
cd ../..
git add -A && git commit -m "feat(server): add Hono API with session/span/tool endpoints"
```

---

### Task 9: Setup CLI Package

**Files:**
- Create: `packages/cli/package.json`
- Create: `packages/cli/tsconfig.json`
- Create: `packages/cli/src/index.ts`
- Create: `packages/cli/src/commands/open.ts`
- Create: `packages/cli/src/commands/stats.ts`

**Step 1: Create package.json**

`packages/cli/package.json`:
```json
{
  "name": "@ccray/cli",
  "version": "0.1.0",
  "type": "module",
  "bin": {
    "ccray": "dist/index.js"
  },
  "scripts": {
    "build": "tsc",
    "dev": "tsc --watch",
    "test": "bun test"
  },
  "dependencies": {
    "@ccray/shared": "workspace:*",
    "@ccray/parser": "workspace:*",
    "@ccray/db": "workspace:*",
    "@ccray/server": "workspace:*",
    "commander": "^12.1.0"
  }
}
```

**Step 2: Create tsconfig.json**

`packages/cli/tsconfig.json`:
```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "outDir": "dist",
    "rootDir": "src"
  },
  "include": ["src"],
  "references": [
    { "path": "../shared" },
    { "path": "../parser" },
    { "path": "../db" },
    { "path": "../server" }
  ]
}
```

**Step 3: Create stats command**

`packages/cli/src/commands/stats.ts`:
```typescript
import { Database } from "bun:sqlite";
import { homedir } from "node:os";
import { join } from "node:path";
import { createSchema, Repository } from "@ccray/db";
import { discoverSessions, readJsonlLines, normalizeEvent } from "@ccray/parser";
import { estimateCost } from "@ccray/shared";

export interface StatsOptions {
  json?: boolean;
}

export async function statsCommand(
  path: string | undefined,
  options: StatsOptions
): Promise<void> {
  const targetPath = path ?? join(homedir(), ".claude", "projects");

  // Create in-memory DB for stats
  const db = new Database(":memory:");
  createSchema(db);
  const repo = new Repository(db);

  const sessions = await discoverSessions(targetPath);

  if (sessions.length === 0) {
    console.log("No sessions found.");
    return;
  }

  // Process first session for now
  const session = sessions[0];

  // Parse the session
  const file = Bun.file(session.mainPath);
  const stream = file.stream();

  let lineNo = 0;
  let totalInputTokens = 0;
  let totalOutputTokens = 0;
  let totalCacheRead = 0;
  let totalCacheWrite = 0;
  let startTs = Infinity;
  let endTs = 0;
  let model: string | null = null;

  for await (const raw of readJsonlLines(stream)) {
    lineNo++;
    const event = normalizeEvent(raw, lineNo);

    if (event.ts < startTs) startTs = event.ts;
    if (event.ts > endTs) endTs = event.ts;

    if (event.tokenUsage) {
      totalInputTokens += event.tokenUsage.inputTokens;
      totalOutputTokens += event.tokenUsage.outputTokens;
      totalCacheRead += event.tokenUsage.cacheReadInputTokens;
      totalCacheWrite += event.tokenUsage.cacheCreationInputTokens;
    }

    if (event.model) {
      model = event.model;
    }
  }

  const durationMs = endTs - startTs;
  const cost = estimateCost(
    model,
    totalInputTokens,
    totalOutputTokens,
    totalCacheRead,
    totalCacheWrite
  );

  if (options.json) {
    console.log(JSON.stringify({
      sessionId: session.sessionId,
      durationMs,
      totalInputTokens,
      totalOutputTokens,
      totalCacheReadTokens: totalCacheRead,
      totalCacheWriteTokens: totalCacheWrite,
      estimatedCostUsd: cost,
      model,
    }, null, 2));
  } else {
    console.log(`\nSession: ${session.sessionId}`);
    console.log(`Duration: ${(durationMs / 1000).toFixed(1)}s`);
    console.log(`Model: ${model ?? "unknown"}`);
    console.log(`\nTokens:`);
    console.log(`  Input:       ${totalInputTokens.toLocaleString()}`);
    console.log(`  Output:      ${totalOutputTokens.toLocaleString()}`);
    console.log(`  Cache Read:  ${totalCacheRead.toLocaleString()}`);
    console.log(`  Cache Write: ${totalCacheWrite.toLocaleString()}`);
    console.log(`\nEstimated Cost: $${cost.toFixed(4)}`);
  }

  db.close();
}
```

**Step 4: Create open command (placeholder)**

`packages/cli/src/commands/open.ts`:
```typescript
import { Database } from "bun:sqlite";
import { homedir } from "node:os";
import { join } from "node:path";
import { createSchema, Repository } from "@ccray/db";
import { createApp } from "@ccray/server";

export interface OpenOptions {
  port?: number;
  noBrowser?: boolean;
}

export async function openCommand(
  path: string | undefined,
  options: OpenOptions
): Promise<void> {
  const port = options.port ?? 3333;
  const cacheDir = join(homedir(), ".cache", "ccray");
  const dbPath = join(cacheDir, "ccray.db");

  // Ensure cache directory exists
  await Bun.write(join(cacheDir, ".keep"), "");

  const db = new Database(dbPath);
  createSchema(db);
  const repo = new Repository(db);

  const app = createApp(repo);

  console.log(`Starting ccray server on http://127.0.0.1:${port}`);

  Bun.serve({
    port,
    hostname: "127.0.0.1",
    fetch: app.fetch,
  });

  if (!options.noBrowser) {
    // Open browser (platform-specific)
    const cmd = process.platform === "darwin" ? "open" : "xdg-open";
    Bun.spawn([cmd, `http://127.0.0.1:${port}`]);
  }

  // Keep process running
  await new Promise(() => {});
}
```

**Step 5: Create main CLI entry**

`packages/cli/src/index.ts`:
```typescript
#!/usr/bin/env bun
import { Command } from "commander";
import { openCommand } from "./commands/open.js";
import { statsCommand } from "./commands/stats.js";

const program = new Command();

program
  .name("ccray")
  .description("Claude Code trace debugger")
  .version("0.1.0");

program
  .command("open")
  .description("Parse sessions and launch the debugger UI")
  .argument("[path]", "Session or project path (default: ~/.claude/projects)")
  .option("-p, --port <number>", "Port for local server", "3333")
  .option("--no-browser", "Don't auto-open browser")
  .action(openCommand);

program
  .command("stats")
  .description("Print session statistics to terminal")
  .argument("[path]", "Session path")
  .option("--json", "Output as JSON")
  .action(statsCommand);

program.parse();
```

**Step 6: Install dependencies and build**

```bash
cd packages/cli && pnpm install && pnpm build
```

**Step 7: Commit**

```bash
cd ../..
git add -A && git commit -m "feat(cli): add ccray CLI with open and stats commands"
```

---

## Phase 4: Web UI

### Task 10: Setup Web Package (React + Vite)

**Files:**
- Create: `packages/web/package.json`
- Create: `packages/web/tsconfig.json`
- Create: `packages/web/vite.config.ts`
- Create: `packages/web/index.html`
- Create: `packages/web/src/main.tsx`
- Create: `packages/web/src/App.tsx`
- Create: `packages/web/src/index.css`

**Step 1: Create package.json**

`packages/web/package.json`:
```json
{
  "name": "@ccray/web",
  "version": "0.1.0",
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "vite build",
    "preview": "vite preview"
  },
  "dependencies": {
    "@ccray/shared": "workspace:*",
    "@tanstack/react-table": "^8.20.0",
    "react": "^18.3.0",
    "react-dom": "^18.3.0",
    "react-router-dom": "^6.28.0"
  },
  "devDependencies": {
    "@types/react": "^18.3.0",
    "@types/react-dom": "^18.3.0",
    "@vitejs/plugin-react": "^4.3.0",
    "vite": "^5.4.0"
  }
}
```

**Step 2: Create vite.config.ts**

`packages/web/vite.config.ts`:
```typescript
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      "/api": {
        target: "http://127.0.0.1:3333",
        changeOrigin: true,
      },
    },
  },
  build: {
    outDir: "dist",
  },
});
```

**Step 3: Create tsconfig.json**

`packages/web/tsconfig.json`:
```json
{
  "compilerOptions": {
    "target": "ES2020",
    "useDefineForClassFields": true,
    "lib": ["ES2020", "DOM", "DOM.Iterable"],
    "module": "ESNext",
    "skipLibCheck": true,
    "moduleResolution": "bundler",
    "allowImportingTsExtensions": true,
    "resolveJsonModule": true,
    "isolatedModules": true,
    "noEmit": true,
    "jsx": "react-jsx",
    "strict": true,
    "noUnusedLocals": true,
    "noUnusedParameters": true,
    "noFallthroughCasesInSwitch": true
  },
  "include": ["src"],
  "references": [{ "path": "../shared" }]
}
```

**Step 4: Create index.html**

`packages/web/index.html`:
```html
<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>ccray - Claude Code Trace Debugger</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
```

**Step 5: Create index.css**

`packages/web/src/index.css`:
```css
:root {
  --bg-primary: #0d1117;
  --bg-secondary: #161b22;
  --bg-tertiary: #21262d;
  --text-primary: #c9d1d9;
  --text-secondary: #8b949e;
  --border: #30363d;
  --accent: #58a6ff;
  --success: #3fb950;
  --error: #f85149;
  --warning: #d29922;
}

* {
  box-sizing: border-box;
  margin: 0;
  padding: 0;
}

body {
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
  background: var(--bg-primary);
  color: var(--text-primary);
  line-height: 1.5;
}

a {
  color: var(--accent);
  text-decoration: none;
}

a:hover {
  text-decoration: underline;
}
```

**Step 6: Create main.tsx**

`packages/web/src/main.tsx`:
```tsx
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { App } from "./App";
import "./index.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </StrictMode>
);
```

**Step 7: Create App.tsx**

`packages/web/src/App.tsx`:
```tsx
import { Routes, Route } from "react-router-dom";
import { SessionExplorer } from "./pages/SessionExplorer";
import { SessionView } from "./pages/SessionView";

export function App() {
  return (
    <div className="app">
      <header className="app-header">
        <h1>ccray</h1>
        <span className="subtitle">Claude Code Trace Debugger</span>
      </header>
      <main>
        <Routes>
          <Route path="/" element={<SessionExplorer />} />
          <Route path="/session/:id" element={<SessionView />} />
        </Routes>
      </main>
    </div>
  );
}
```

**Step 8: Install dependencies**

```bash
cd packages/web && pnpm install
```

**Step 9: Commit**

```bash
cd ../..
git add -A && git commit -m "feat(web): scaffold React app with Vite and routing"
```

---

### Task 11: Session Explorer Page

**Files:**
- Create: `packages/web/src/pages/SessionExplorer.tsx`
- Create: `packages/web/src/hooks/useApi.ts`
- Create: `packages/web/src/components/SessionTable.tsx`

**Step 1: Create useApi hook**

`packages/web/src/hooks/useApi.ts`:
```typescript
import { useState, useEffect } from "react";

export function useApi<T>(url: string) {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function fetchData() {
      try {
        setLoading(true);
        const res = await fetch(url);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const json = await res.json();
        if (!cancelled) setData(json);
      } catch (e) {
        if (!cancelled) setError(e as Error);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    fetchData();
    return () => { cancelled = true; };
  }, [url]);

  return { data, loading, error };
}
```

**Step 2: Create SessionTable component**

`packages/web/src/components/SessionTable.tsx`:
```tsx
import { Link } from "react-router-dom";
import type { Session } from "@ccray/shared";

interface Props {
  sessions: Session[];
}

export function SessionTable({ sessions }: Props) {
  return (
    <table className="session-table">
      <thead>
        <tr>
          <th>Session</th>
          <th>Project</th>
          <th>Duration</th>
          <th>Tokens (In/Out)</th>
          <th>Cost</th>
          <th>Started</th>
        </tr>
      </thead>
      <tbody>
        {sessions.map((s) => (
          <tr key={s.sessionId}>
            <td>
              <Link to={`/session/${s.sessionId}`}>
                {s.sessionId.slice(0, 8)}...
              </Link>
            </td>
            <td className="project-path">{s.projectPath.split("/").pop()}</td>
            <td>{formatDuration(s.durationMs)}</td>
            <td>
              {s.totalInputTokens.toLocaleString()} / {s.totalOutputTokens.toLocaleString()}
            </td>
            <td>${s.estimatedCostUsd.toFixed(4)}</td>
            <td>{formatDate(s.startTs)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function formatDuration(ms: number): string {
  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  if (minutes > 0) {
    return `${minutes}m ${seconds % 60}s`;
  }
  return `${seconds}s`;
}

function formatDate(ts: number): string {
  return new Date(ts).toLocaleString();
}
```

**Step 3: Create SessionExplorer page**

`packages/web/src/pages/SessionExplorer.tsx`:
```tsx
import type { Session } from "@ccray/shared";
import { useApi } from "../hooks/useApi";
import { SessionTable } from "../components/SessionTable";

export function SessionExplorer() {
  const { data: sessions, loading, error } = useApi<Session[]>("/api/sessions");

  if (loading) {
    return <div className="loading">Loading sessions...</div>;
  }

  if (error) {
    return <div className="error">Error: {error.message}</div>;
  }

  if (!sessions || sessions.length === 0) {
    return (
      <div className="empty-state">
        <h2>No sessions found</h2>
        <p>Run ccray with a path to Claude Code session files.</p>
      </div>
    );
  }

  return (
    <div className="session-explorer">
      <h2>Sessions ({sessions.length})</h2>
      <SessionTable sessions={sessions} />
    </div>
  );
}
```

**Step 4: Create SessionView placeholder**

`packages/web/src/pages/SessionView.tsx`:
```tsx
import { useParams } from "react-router-dom";
import type { Session, Span } from "@ccray/shared";
import { useApi } from "../hooks/useApi";

export function SessionView() {
  const { id } = useParams<{ id: string }>();
  const { data: session, loading: sessionLoading } = useApi<Session>(`/api/sessions/${id}`);
  const { data: spans, loading: spansLoading } = useApi<Span[]>(`/api/sessions/${id}/spans`);

  if (sessionLoading || spansLoading) {
    return <div className="loading">Loading session...</div>;
  }

  if (!session) {
    return <div className="error">Session not found</div>;
  }

  return (
    <div className="session-view">
      <h2>Session: {session.sessionId.slice(0, 8)}...</h2>
      <div className="session-meta">
        <span>Duration: {(session.durationMs / 1000).toFixed(1)}s</span>
        <span>Cost: ${session.estimatedCostUsd.toFixed(4)}</span>
        <span>Tokens: {session.totalInputTokens.toLocaleString()} in / {session.totalOutputTokens.toLocaleString()} out</span>
      </div>

      <h3>Spans ({spans?.length ?? 0})</h3>
      <div className="timeline-placeholder">
        Timeline visualization will be implemented with PixiJS
      </div>
    </div>
  );
}
```

**Step 5: Add styles**

Append to `packages/web/src/index.css`:
```css
/* ... existing styles ... */

.app-header {
  padding: 1rem 2rem;
  background: var(--bg-secondary);
  border-bottom: 1px solid var(--border);
  display: flex;
  align-items: baseline;
  gap: 1rem;
}

.app-header h1 {
  font-size: 1.5rem;
  font-weight: 600;
}

.app-header .subtitle {
  color: var(--text-secondary);
  font-size: 0.875rem;
}

main {
  padding: 2rem;
}

.session-explorer h2 {
  margin-bottom: 1rem;
}

.session-table {
  width: 100%;
  border-collapse: collapse;
}

.session-table th,
.session-table td {
  padding: 0.75rem 1rem;
  text-align: left;
  border-bottom: 1px solid var(--border);
}

.session-table th {
  background: var(--bg-secondary);
  color: var(--text-secondary);
  font-weight: 500;
  font-size: 0.875rem;
}

.session-table tr:hover {
  background: var(--bg-secondary);
}

.project-path {
  color: var(--text-secondary);
  font-family: monospace;
  font-size: 0.875rem;
}

.loading,
.error,
.empty-state {
  padding: 2rem;
  text-align: center;
  color: var(--text-secondary);
}

.error {
  color: var(--error);
}

.session-view .session-meta {
  display: flex;
  gap: 2rem;
  margin: 1rem 0;
  color: var(--text-secondary);
}

.timeline-placeholder {
  background: var(--bg-secondary);
  border: 1px solid var(--border);
  border-radius: 4px;
  padding: 4rem 2rem;
  text-align: center;
  color: var(--text-secondary);
  margin-top: 1rem;
}
```

**Step 6: Commit**

```bash
cd ../..
git add -A && git commit -m "feat(web): add session explorer and session view pages"
```

---

### Task 12: Tool Profiler Component

**Files:**
- Create: `packages/web/src/components/ToolProfiler.tsx`
- Modify: `packages/web/src/pages/SessionView.tsx`

**Step 1: Create ToolProfiler component**

`packages/web/src/components/ToolProfiler.tsx`:
```tsx
import type { ToolStats } from "@ccray/db";
import { useApi } from "../hooks/useApi";

interface Props {
  sessionId: string;
}

export function ToolProfiler({ sessionId }: Props) {
  const { data: stats, loading, error } = useApi<ToolStats[]>(
    `/api/sessions/${sessionId}/tools`
  );

  if (loading) return <div className="loading">Loading tool stats...</div>;
  if (error) return <div className="error">Error loading tools</div>;
  if (!stats || stats.length === 0) return <div>No tool calls found</div>;

  return (
    <div className="tool-profiler">
      <table className="tool-table">
        <thead>
          <tr>
            <th>Tool</th>
            <th>Family</th>
            <th>Calls</th>
            <th>Total Time</th>
            <th>Avg</th>
            <th>P95</th>
            <th>Max</th>
            <th>Errors</th>
            <th>I/O Bytes</th>
          </tr>
        </thead>
        <tbody>
          {stats.map((tool) => (
            <tr key={`${tool.toolName}-${tool.mcpServer ?? ""}`}>
              <td className="tool-name">
                {tool.mcpServer ? `${tool.mcpServer}::${tool.toolName}` : tool.toolName}
              </td>
              <td>
                <span className={`badge badge-${tool.toolFamily}`}>
                  {tool.toolFamily}
                </span>
              </td>
              <td>{tool.callCount}</td>
              <td>{formatMs(tool.totalDurationMs)}</td>
              <td>{formatMs(tool.avgDurationMs)}</td>
              <td>{formatMs(tool.p95DurationMs)}</td>
              <td>{formatMs(tool.maxDurationMs)}</td>
              <td className={tool.errorCount > 0 ? "has-errors" : ""}>
                {tool.errorCount} ({(tool.errorRate * 100).toFixed(1)}%)
              </td>
              <td>
                {formatBytes(tool.totalInputBytes)} / {formatBytes(tool.totalOutputBytes)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function formatMs(ms: number): string {
  if (ms < 1000) return `${ms.toFixed(0)}ms`;
  return `${(ms / 1000).toFixed(2)}s`;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)}MB`;
}
```

**Step 2: Update SessionView to include ToolProfiler**

`packages/web/src/pages/SessionView.tsx`:
```tsx
import { useParams, Link } from "react-router-dom";
import type { Session, Span } from "@ccray/shared";
import { useApi } from "../hooks/useApi";
import { ToolProfiler } from "../components/ToolProfiler";

export function SessionView() {
  const { id } = useParams<{ id: string }>();
  const { data: session, loading: sessionLoading } = useApi<Session>(`/api/sessions/${id}`);
  const { data: spans, loading: spansLoading } = useApi<Span[]>(`/api/sessions/${id}/spans`);

  if (sessionLoading || spansLoading) {
    return <div className="loading">Loading session...</div>;
  }

  if (!session) {
    return <div className="error">Session not found</div>;
  }

  return (
    <div className="session-view">
      <nav className="breadcrumb">
        <Link to="/">Sessions</Link> / {session.sessionId.slice(0, 8)}...
      </nav>

      <h2>Session Details</h2>
      <div className="session-meta">
        <div className="meta-item">
          <span className="label">Duration</span>
          <span className="value">{(session.durationMs / 1000).toFixed(1)}s</span>
        </div>
        <div className="meta-item">
          <span className="label">Cost</span>
          <span className="value">${session.estimatedCostUsd.toFixed(4)}</span>
        </div>
        <div className="meta-item">
          <span className="label">Input Tokens</span>
          <span className="value">{session.totalInputTokens.toLocaleString()}</span>
        </div>
        <div className="meta-item">
          <span className="label">Output Tokens</span>
          <span className="value">{session.totalOutputTokens.toLocaleString()}</span>
        </div>
        <div className="meta-item">
          <span className="label">Cache Read</span>
          <span className="value">{session.totalCacheReadTokens.toLocaleString()}</span>
        </div>
      </div>

      <section className="section">
        <h3>Timeline ({spans?.length ?? 0} spans)</h3>
        <div className="timeline-placeholder">
          Timeline visualization will be implemented with PixiJS
        </div>
      </section>

      <section className="section">
        <h3>Tool Profiler</h3>
        <ToolProfiler sessionId={session.sessionId} />
      </section>
    </div>
  );
}
```

**Step 3: Add more styles**

Append to `packages/web/src/index.css`:
```css
/* ... existing styles ... */

.breadcrumb {
  margin-bottom: 1rem;
  color: var(--text-secondary);
}

.session-meta {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
  gap: 1rem;
  margin: 1rem 0 2rem;
}

.meta-item {
  background: var(--bg-secondary);
  padding: 1rem;
  border-radius: 4px;
}

.meta-item .label {
  display: block;
  color: var(--text-secondary);
  font-size: 0.75rem;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  margin-bottom: 0.25rem;
}

.meta-item .value {
  font-size: 1.25rem;
  font-weight: 500;
}

.section {
  margin-top: 2rem;
}

.section h3 {
  margin-bottom: 1rem;
}

.tool-profiler {
  overflow-x: auto;
}

.tool-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 0.875rem;
}

.tool-table th,
.tool-table td {
  padding: 0.5rem 0.75rem;
  text-align: left;
  border-bottom: 1px solid var(--border);
}

.tool-table th {
  background: var(--bg-secondary);
  color: var(--text-secondary);
  font-weight: 500;
}

.tool-name {
  font-family: monospace;
}

.badge {
  display: inline-block;
  padding: 0.125rem 0.5rem;
  border-radius: 9999px;
  font-size: 0.75rem;
  font-weight: 500;
}

.badge-builtin {
  background: rgba(59, 130, 246, 0.2);
  color: #60a5fa;
}

.badge-mcp {
  background: rgba(168, 85, 247, 0.2);
  color: #c084fc;
}

.has-errors {
  color: var(--error);
}
```

**Step 4: Commit**

```bash
cd ../..
git add -A && git commit -m "feat(web): add tool profiler component with stats table"
```

---

## Phase 5: Integration & Build

### Task 13: Wire Up Ingestion Pipeline

**Files:**
- Create: `packages/parser/src/ingest.ts`
- Modify: `packages/cli/src/commands/open.ts`

**Step 1: Create ingest pipeline**

`packages/parser/src/ingest.ts`:
```typescript
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
```

**Step 2: Update open command**

`packages/cli/src/commands/open.ts`:
```typescript
import { Database } from "bun:sqlite";
import { homedir } from "node:os";
import { join } from "node:path";
import { mkdir } from "node:fs/promises";
import { createSchema, Repository } from "@ccray/db";
import { createApp } from "@ccray/server";
import { ingestAll } from "@ccray/parser";

export interface OpenOptions {
  port?: number;
  noBrowser?: boolean;
  reindex?: boolean;
}

export async function openCommand(
  path: string | undefined,
  options: OpenOptions
): Promise<void> {
  const port = options.port ? parseInt(options.port as unknown as string, 10) : 3333;
  const targetPath = path ?? join(homedir(), ".claude", "projects");
  const cacheDir = join(homedir(), ".cache", "ccray");
  const dbPath = join(cacheDir, "ccray.db");

  // Ensure cache directory exists
  await mkdir(cacheDir, { recursive: true });

  console.log(`Scanning ${targetPath}...`);

  const db = new Database(dbPath);

  // Ingest sessions
  const sessions = await ingestAll(db, targetPath, { reindex: options.reindex });

  if (sessions.length === 0) {
    console.log("No sessions found.");
    db.close();
    return;
  }

  console.log(`\nIngested ${sessions.length} session(s)`);

  const repo = new Repository(db);
  const app = createApp(repo);

  console.log(`\nStarting server on http://127.0.0.1:${port}`);

  Bun.serve({
    port,
    hostname: "127.0.0.1",
    fetch: app.fetch,
  });

  if (!options.noBrowser) {
    const cmd = process.platform === "darwin" ? "open" : "xdg-open";
    Bun.spawn([cmd, `http://127.0.0.1:${port}`]);
  }

  console.log("Press Ctrl+C to stop");

  // Keep process running
  await new Promise(() => {});
}
```

**Step 3: Update parser index.ts**

`packages/parser/src/index.ts`:
```typescript
export * from "./reader.js";
export * from "./discovery.js";
export * from "./normalizer.js";
export * from "./ingest.js";
```

**Step 4: Commit**

```bash
cd ../..
git add -A && git commit -m "feat: wire up full ingestion pipeline from CLI to DB"
```

---

### Task 14: Build Standalone Binary

**Files:**
- Create: `scripts/build.ts`
- Modify: `package.json`

**Step 1: Create build script**

`scripts/build.ts`:
```typescript
import { $ } from "bun";

async function build() {
  console.log("Building packages...");

  // Build all packages
  await $`pnpm -r build`;

  // Build web assets
  console.log("\nBuilding web UI...");
  await $`cd packages/web && pnpm build`;

  // Compile CLI to standalone binary
  console.log("\nCompiling standalone binary...");
  await $`bun build packages/cli/src/index.ts --compile --outfile dist/ccray`;

  console.log("\nBuild complete! Binary at: dist/ccray");
}

build().catch(console.error);
```

**Step 2: Update root package.json**

`package.json`:
```json
{
  "name": "ccray",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "pnpm -r dev",
    "build": "bun scripts/build.ts",
    "build:packages": "pnpm -r build",
    "test": "pnpm -r test",
    "lint": "biome check .",
    "format": "biome format --write ."
  },
  "devDependencies": {
    "@biomejs/biome": "^1.9.0",
    "typescript": "^5.7.0"
  }
}
```

**Step 3: Create dist directory**

```bash
mkdir -p dist
echo "dist/" >> .gitignore
```

**Step 4: Commit**

```bash
git add -A && git commit -m "feat: add build script for standalone binary"
```

---

### Task 15: Final Integration Test

**Step 1: Build everything**

```bash
pnpm install
pnpm build
```

**Step 2: Test the binary**

```bash
./dist/ccray stats ~/.claude/projects/<some-project>/<session-id>
```

Expected: Should print session stats with token counts and cost.

**Step 3: Test the full flow**

```bash
./dist/ccray open ~/.claude/projects/<some-project> --no-browser
```

Expected: Should start server on port 3333.

**Step 4: Test API**

```bash
curl http://127.0.0.1:3333/api/sessions
```

Expected: Should return JSON array of sessions.

**Step 5: Commit**

```bash
git add -A && git commit -m "test: verify full integration works"
```

---

## Summary

This plan implements ccray MVP with:

1. **Phase 1** - Project foundation (monorepo, shared types, parser basics)
2. **Phase 2** - Database layer (SQLite schema, repository)
3. **Phase 3** - Server & CLI (Hono API, commander CLI)
4. **Phase 4** - Web UI (React, session explorer, tool profiler)
5. **Phase 5** - Integration (ingestion pipeline, standalone binary)

After completing these tasks, you'll have:
- `ccray open` - launches debugger UI
- `ccray stats` - prints terminal summary
- Session explorer with cost tracking
- Tool profiler with timing stats
- Foundation for PixiJS timeline (placeholder ready)

**Next steps after MVP:**
- Implement PixiJS timeline visualization
- Add flamegraph/icicle view
- Add subagent parsing
- Add live mode (`--follow`)
