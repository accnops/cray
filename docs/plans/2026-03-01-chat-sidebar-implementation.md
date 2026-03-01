# Chat Sidebar Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add a right sidebar to ccray that displays conversation messages with split panes for parallel subagents.

**Architecture:** Server-side message parsing via new `getMessages()` repository method. New `/api/messages` endpoint. React components: ChatSidebar (container with resize), AgentPane (scrollable per-agent), ChatMessage (collapsed/expanded), ContentBlock (renders text/thinking/tool blocks).

**Tech Stack:** TypeScript, Hono (server), React (frontend), bun:sqlite, existing CSS variables

---

## Task 1: Add ChatMessage Types

**Files:**
- Modify: `packages/shared/src/types.ts`

**Step 1: Add new types to shared package**

Add to end of `packages/shared/src/types.ts`:

```typescript
export type ChatContentBlock =
  | { type: "text"; text: string }
  | { type: "thinking"; text: string }
  | { type: "tool_use"; toolName: string; toolId: string; input: unknown }
  | { type: "tool_result"; toolId: string; output: string; isError: boolean };

export interface ChatMessage {
  eventId: string;
  agentId: string;
  agentKind: AgentKind;
  ts: number;
  role: "user" | "assistant";
  content: ChatContentBlock[];
}

export interface AgentInfo {
  agentId: string;
  kind: AgentKind;
  label: string;
}

export interface MessagesResponse {
  messages: ChatMessage[];
  agents: AgentInfo[];
}
```

**Step 2: Export new types from index**

Verify `packages/shared/src/index.ts` re-exports from types.ts (it should already).

**Step 3: Build shared package**

Run: `cd packages/shared && bun run build`
Expected: Build completes without errors

**Step 4: Commit**

```bash
git add packages/shared/src/types.ts
git commit -m "feat(shared): add ChatMessage and related types for chat sidebar"
```

---

## Task 2: Add getMessages Repository Method

**Files:**
- Modify: `packages/db/src/repository.ts`
- Create: `packages/db/src/repository.test.ts` (add test)

**Step 1: Write the failing test**

Add to `packages/db/src/repository.test.ts`:

```typescript
import { describe, test, expect, beforeEach } from "bun:test";
import { Database } from "bun:sqlite";
import { Repository } from "./repository";
import { initSchema } from "./schema";

describe("Repository.getMessages", () => {
  let db: Database;
  let repo: Repository;

  beforeEach(() => {
    db = new Database(":memory:");
    initSchema(db);
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
```

**Step 2: Run test to verify it fails**

Run: `cd packages/db && bun test repository.test.ts`
Expected: FAIL with "repo.getMessages is not a function"

**Step 3: Import ChatMessage types in repository**

Add to imports at top of `packages/db/src/repository.ts`:

```typescript
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
```

**Step 4: Implement getMessages method**

Add to `Repository` class in `packages/db/src/repository.ts`:

```typescript
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
```

**Step 5: Run test to verify it passes**

Run: `cd packages/db && bun test repository.test.ts`
Expected: PASS

**Step 6: Build db package**

Run: `cd packages/db && bun run build`
Expected: Build completes without errors

**Step 7: Commit**

```bash
git add packages/db/src/repository.ts packages/db/src/repository.test.ts
git commit -m "feat(db): add getMessages repository method with server-side parsing"
```

---

## Task 3: Add /api/messages Endpoint

**Files:**
- Modify: `packages/server/src/routes.ts`
- Modify: `packages/server/src/routes.test.ts`

**Step 1: Write the failing test**

Add to `packages/server/src/routes.test.ts`:

```typescript
describe("GET /api/messages", () => {
  test("returns messages for sessions", async () => {
    const res = await app.request("/api/messages?sessions=sess1");
    expect(res.status).toBe(200);

    const data = await res.json();
    expect(data).toHaveProperty("messages");
    expect(data).toHaveProperty("agents");
    expect(Array.isArray(data.messages)).toBe(true);
  });

  test("filters by time range", async () => {
    const res = await app.request("/api/messages?sessions=sess1&startTime=1000&endTime=2000");
    expect(res.status).toBe(200);
  });
});
```

**Step 2: Run test to verify it fails**

Run: `cd packages/server && bun test routes.test.ts`
Expected: FAIL with 404

**Step 3: Add the endpoint**

Add to `packages/server/src/routes.ts` after the `/api/aggregate` endpoint:

```typescript
app.get("/api/messages", (c) => {
  const sessionIdsParam = c.req.query("sessions");
  const sessionIds = sessionIdsParam ? sessionIdsParam.split(",") : [];

  const startTimeParam = c.req.query("startTime");
  const endTimeParam = c.req.query("endTime");
  const startTime = startTimeParam ? parseInt(startTimeParam, 10) : undefined;
  const endTime = endTimeParam ? parseInt(endTimeParam, 10) : undefined;

  // If no sessions specified, use all
  const ids = sessionIds.length > 0 ? sessionIds : repo.listSessions().map(s => s.sessionId);

  const data = repo.getMessages(ids, startTime, endTime);
  return c.json(data);
});
```

**Step 4: Run test to verify it passes**

Run: `cd packages/server && bun test routes.test.ts`
Expected: PASS

**Step 5: Build server package**

Run: `cd packages/server && bun run build`
Expected: Build completes without errors

**Step 6: Commit**

```bash
git add packages/server/src/routes.ts packages/server/src/routes.test.ts
git commit -m "feat(server): add /api/messages endpoint"
```

---

## Task 4: Add Chat Sidebar CSS

**Files:**
- Modify: `packages/web/src/index.css`

**Step 1: Add CSS variables and sidebar styles**

Add to end of `packages/web/src/index.css`:

```css
/* Chat Sidebar */
:root {
  --sidebar-width: 400px;
  --sidebar-min-width: 300px;
  --sidebar-max-width: 600px;
  --message-user-bg: rgba(88, 166, 255, 0.1);
}

.dashboard-body {
  display: flex;
  flex: 1;
  overflow: hidden;
}

.main-content {
  flex: 1;
  overflow-y: auto;
  padding: 2rem;
  display: flex;
  flex-direction: column;
  gap: 2rem;
}

.chat-sidebar {
  width: var(--sidebar-width);
  min-width: var(--sidebar-min-width);
  max-width: var(--sidebar-max-width);
  border-left: 1px solid var(--border);
  background: var(--bg-secondary);
  display: flex;
  flex-direction: column;
  position: relative;
}

.chat-sidebar.collapsed {
  width: 40px;
  min-width: 40px;
}

.sidebar-resize-handle {
  position: absolute;
  left: 0;
  top: 0;
  bottom: 0;
  width: 4px;
  cursor: ew-resize;
  background: transparent;
}

.sidebar-resize-handle:hover {
  background: var(--accent);
}

.sidebar-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0.75rem;
  border-bottom: 1px solid var(--border);
  background: var(--bg-tertiary);
}

.sidebar-header h3 {
  font-size: 0.875rem;
  font-weight: 500;
  margin: 0;
}

.collapse-btn {
  background: none;
  border: none;
  color: var(--text-secondary);
  cursor: pointer;
  padding: 0.25rem;
  font-size: 1rem;
}

.collapse-btn:hover {
  color: var(--text-primary);
}

.agent-panes {
  display: flex;
  flex: 1;
  overflow: hidden;
}

.agent-pane {
  flex: 1;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
}

.agent-pane:not(:last-child) {
  border-right: 1px solid var(--border);
}

.agent-pane-header {
  position: sticky;
  top: 0;
  background: var(--bg-tertiary);
  padding: 0.5rem 0.75rem;
  font-size: 0.75rem;
  font-weight: 500;
  color: var(--text-secondary);
  border-bottom: 1px solid var(--border);
  z-index: 1;
}

.agent-pane-messages {
  flex: 1;
}

.chat-message {
  padding: 0.75rem;
  border-bottom: 1px solid var(--border);
  cursor: pointer;
  transition: background 0.1s;
}

.chat-message:hover {
  background: var(--bg-tertiary);
}

.chat-message.user {
  background: var(--message-user-bg);
}

.chat-message.user:hover {
  background: rgba(88, 166, 255, 0.15);
}

.chat-message.expanded {
  cursor: default;
  background: var(--bg-tertiary);
}

.message-header {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  margin-bottom: 0.25rem;
}

.message-role {
  font-size: 0.75rem;
  font-weight: 500;
  color: var(--text-secondary);
}

.message-role.user {
  color: var(--accent);
}

.message-time {
  font-size: 0.625rem;
  color: var(--text-secondary);
  margin-left: auto;
}

.message-preview {
  font-size: 0.8125rem;
  color: var(--text-primary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.message-badges {
  display: flex;
  gap: 0.25rem;
  margin-top: 0.25rem;
}

.tool-count-badge {
  display: inline-flex;
  align-items: center;
  gap: 0.25rem;
  padding: 0.125rem 0.375rem;
  border-radius: 9999px;
  font-size: 0.625rem;
  font-weight: 500;
  background: rgba(96, 165, 250, 0.2);
  color: #60a5fa;
}

.message-content {
  font-size: 0.8125rem;
  line-height: 1.6;
}

.content-block {
  margin: 0.5rem 0;
}

.content-block:first-child {
  margin-top: 0;
}

.text-block {
  white-space: pre-wrap;
  word-break: break-word;
}

.thinking-block {
  font-style: italic;
  color: var(--text-secondary);
  border-left: 2px solid var(--border);
  padding-left: 0.75rem;
}

.tool-use-block {
  background: var(--bg-primary);
  border-radius: 4px;
  padding: 0.5rem;
  border: 1px solid var(--border);
}

.tool-use-header {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  margin-bottom: 0.25rem;
}

.tool-name {
  font-family: monospace;
  font-size: 0.75rem;
  font-weight: 500;
  color: #60a5fa;
}

.tool-name.mcp {
  color: #c084fc;
}

.tool-input {
  font-family: monospace;
  font-size: 0.6875rem;
  color: var(--text-secondary);
  white-space: pre-wrap;
  word-break: break-all;
  max-height: 200px;
  overflow-y: auto;
}

.tool-result-block {
  background: var(--bg-primary);
  border-radius: 4px;
  padding: 0.5rem;
  border: 1px solid var(--border);
  font-family: monospace;
  font-size: 0.6875rem;
  white-space: pre-wrap;
  word-break: break-word;
  max-height: 300px;
  overflow-y: auto;
}

.tool-result-block.error {
  border-left: 3px solid var(--error);
}

.sidebar-empty {
  display: flex;
  align-items: center;
  justify-content: center;
  flex: 1;
  color: var(--text-secondary);
  font-size: 0.875rem;
  padding: 2rem;
  text-align: center;
}

.sidebar-loading {
  display: flex;
  align-items: center;
  justify-content: center;
  flex: 1;
  color: var(--text-secondary);
}
```

**Step 2: Update dashboard-main to use new structure**

Find in `packages/web/src/index.css`:
```css
.dashboard-main {
  padding: 2rem;
  display: flex;
  flex-direction: column;
  gap: 2rem;
}
```

Replace with:
```css
.dashboard-main {
  display: flex;
  flex-direction: column;
  flex: 1;
  overflow: hidden;
}
```

**Step 3: Commit**

```bash
git add packages/web/src/index.css
git commit -m "feat(web): add chat sidebar CSS styles"
```

---

## Task 5: Create ContentBlock Component

**Files:**
- Create: `packages/web/src/components/ContentBlock.tsx`

**Step 1: Create the component**

```typescript
import type { ChatContentBlock } from "@ccray/shared";

interface ContentBlockProps {
  block: ChatContentBlock;
}

export function ContentBlock({ block }: ContentBlockProps) {
  if (block.type === "text") {
    return <div className="content-block text-block">{block.text}</div>;
  }

  if (block.type === "thinking") {
    return <div className="content-block thinking-block">{block.text}</div>;
  }

  if (block.type === "tool_use") {
    const isMcp = block.toolName.startsWith("mcp__");
    return (
      <div className="content-block tool-use-block">
        <div className="tool-use-header">
          <span className={`tool-name ${isMcp ? "mcp" : ""}`}>{block.toolName}</span>
        </div>
        <div className="tool-input">
          {typeof block.input === "string"
            ? block.input
            : JSON.stringify(block.input, null, 2)}
        </div>
      </div>
    );
  }

  if (block.type === "tool_result") {
    return (
      <div className={`content-block tool-result-block ${block.isError ? "error" : ""}`}>
        {block.output}
      </div>
    );
  }

  return null;
}
```

**Step 2: Commit**

```bash
git add packages/web/src/components/ContentBlock.tsx
git commit -m "feat(web): add ContentBlock component"
```

---

## Task 6: Create ChatMessage Component

**Files:**
- Create: `packages/web/src/components/ChatMessageItem.tsx`

**Step 1: Create the component**

```typescript
import { useState } from "react";
import type { ChatMessage } from "@ccray/shared";
import { ContentBlock } from "./ContentBlock";

interface ChatMessageItemProps {
  message: ChatMessage;
}

export function ChatMessageItem({ message }: ChatMessageItemProps) {
  const [expanded, setExpanded] = useState(false);

  const toolCount = message.content.filter(
    (b) => b.type === "tool_use" || b.type === "tool_result"
  ).length;

  const firstTextBlock = message.content.find((b) => b.type === "text");
  const preview = firstTextBlock?.type === "text"
    ? firstTextBlock.text.slice(0, 80) + (firstTextBlock.text.length > 80 ? "..." : "")
    : toolCount > 0
    ? `${toolCount} tool${toolCount > 1 ? "s" : ""}`
    : "";

  const timeStr = new Date(message.ts).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });

  return (
    <div
      className={`chat-message ${message.role} ${expanded ? "expanded" : ""}`}
      onClick={() => setExpanded(!expanded)}
    >
      <div className="message-header">
        <span className={`message-role ${message.role}`}>
          {message.role === "user" ? "User" : "Assistant"}
        </span>
        <span className="message-time">{timeStr}</span>
      </div>

      {expanded ? (
        <div className="message-content">
          {message.content.map((block, i) => (
            <ContentBlock key={i} block={block} />
          ))}
        </div>
      ) : (
        <>
          <div className="message-preview">{preview}</div>
          {toolCount > 0 && (
            <div className="message-badges">
              <span className="tool-count-badge">{toolCount} tool{toolCount > 1 ? "s" : ""}</span>
            </div>
          )}
        </>
      )}
    </div>
  );
}
```

**Step 2: Commit**

```bash
git add packages/web/src/components/ChatMessageItem.tsx
git commit -m "feat(web): add ChatMessageItem component with expand/collapse"
```

---

## Task 7: Create AgentPane Component

**Files:**
- Create: `packages/web/src/components/AgentPane.tsx`

**Step 1: Create the component**

```typescript
import type { ChatMessage, AgentInfo } from "@ccray/shared";
import { ChatMessageItem } from "./ChatMessageItem";

interface AgentPaneProps {
  agent: AgentInfo;
  messages: ChatMessage[];
}

export function AgentPane({ agent, messages }: AgentPaneProps) {
  return (
    <div className="agent-pane">
      <div className="agent-pane-header">{agent.label}</div>
      <div className="agent-pane-messages">
        {messages.map((msg) => (
          <ChatMessageItem key={msg.eventId} message={msg} />
        ))}
      </div>
    </div>
  );
}
```

**Step 2: Commit**

```bash
git add packages/web/src/components/AgentPane.tsx
git commit -m "feat(web): add AgentPane component"
```

---

## Task 8: Create ChatSidebar Component

**Files:**
- Create: `packages/web/src/components/ChatSidebar.tsx`

**Step 1: Create the component**

```typescript
import { useState, useMemo, useCallback, useRef, useEffect } from "react";
import type { MessagesResponse } from "@ccray/shared";
import { useApi } from "../hooks/useApi";
import { AgentPane } from "./AgentPane";

interface ChatSidebarProps {
  sessionIds: string[];
  timeRange: { start: number; end: number } | null;
}

const DEFAULT_WIDTH = 400;
const MIN_WIDTH = 300;
const MAX_WIDTH = 600;
const STORAGE_KEY = "ccray-sidebar-width";

export function ChatSidebar({ sessionIds, timeRange }: ChatSidebarProps) {
  const [collapsed, setCollapsed] = useState(false);
  const [width, setWidth] = useState(() => {
    const saved = localStorage.getItem(STORAGE_KEY);
    return saved ? parseInt(saved, 10) : DEFAULT_WIDTH;
  });

  const isResizing = useRef(false);

  // Build query string
  const queryString = useMemo(() => {
    const params = new URLSearchParams();
    if (sessionIds.length > 0) {
      params.set("sessions", sessionIds.join(","));
    }
    if (timeRange) {
      params.set("startTime", timeRange.start.toString());
      params.set("endTime", timeRange.end.toString());
    }
    const str = params.toString();
    return str ? `?${str}` : "";
  }, [sessionIds, timeRange]);

  const { data, loading } = useApi<MessagesResponse>(
    sessionIds.length > 0 ? `/api/messages${queryString}` : null
  );

  // Group messages by agent
  const messagesByAgent = useMemo(() => {
    if (!data) return new Map();
    const map = new Map<string, typeof data.messages>();
    for (const msg of data.messages) {
      const existing = map.get(msg.agentId) ?? [];
      existing.push(msg);
      map.set(msg.agentId, existing);
    }
    return map;
  }, [data]);

  // Resize handling
  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    isResizing.current = true;
    document.body.style.cursor = "ew-resize";
    document.body.style.userSelect = "none";
  }, []);

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (!isResizing.current) return;
      const newWidth = window.innerWidth - e.clientX;
      const clamped = Math.max(MIN_WIDTH, Math.min(MAX_WIDTH, newWidth));
      setWidth(clamped);
    };

    const handleMouseUp = () => {
      if (isResizing.current) {
        isResizing.current = false;
        document.body.style.cursor = "";
        document.body.style.userSelect = "";
        localStorage.setItem(STORAGE_KEY, width.toString());
      }
    };

    document.addEventListener("mousemove", handleMouseMove);
    document.addEventListener("mouseup", handleMouseUp);
    return () => {
      document.removeEventListener("mousemove", handleMouseMove);
      document.removeEventListener("mouseup", handleMouseUp);
    };
  }, [width]);

  if (collapsed) {
    return (
      <div className="chat-sidebar collapsed">
        <button className="collapse-btn" onClick={() => setCollapsed(false)} title="Expand">
          ◀
        </button>
      </div>
    );
  }

  return (
    <div className="chat-sidebar" style={{ width }}>
      <div className="sidebar-resize-handle" onMouseDown={handleMouseDown} />
      <div className="sidebar-header">
        <h3>Chat</h3>
        <button className="collapse-btn" onClick={() => setCollapsed(true)} title="Collapse">
          ▶
        </button>
      </div>

      {loading ? (
        <div className="sidebar-loading">Loading...</div>
      ) : !data || data.messages.length === 0 ? (
        <div className="sidebar-empty">No messages in selected range</div>
      ) : (
        <div className="agent-panes">
          {data.agents.map((agent) => (
            <AgentPane
              key={agent.agentId}
              agent={agent}
              messages={messagesByAgent.get(agent.agentId) ?? []}
            />
          ))}
        </div>
      )}
    </div>
  );
}
```

**Step 2: Commit**

```bash
git add packages/web/src/components/ChatSidebar.tsx
git commit -m "feat(web): add ChatSidebar component with resize and collapse"
```

---

## Task 9: Integrate ChatSidebar into Dashboard

**Files:**
- Modify: `packages/web/src/Dashboard.tsx`

**Step 1: Update Dashboard layout**

Add import at top:
```typescript
import { ChatSidebar } from "./components/ChatSidebar";
```

Replace the `<main className="dashboard-main">` section with:

```typescript
<main className="dashboard-main">
  <div className="dashboard-body">
    <div className="main-content">
      {loading ? (
        <div className="loading">Loading data...</div>
      ) : aggregate ? (
        <>
          <section className="panel">
            <h2>Tokens Over Time</h2>
            <TokensChart
              data={aggregate.tokensOverTime}
              onZoomChange={setTimeRange}
              isZoomed={timeRange !== null}
            />
          </section>

          <section className="panel">
            <h2>Time Breakdown</h2>
            <TimeBreakdown data={aggregate.timeBreakdown} sessionDurationMs={aggregate.totals.durationMs} />
          </section>
        </>
      ) : null}
    </div>

    <ChatSidebar sessionIds={selectedIds} timeRange={timeRange} />
  </div>
</main>
```

**Step 2: Run dev server to verify**

Run: `cd packages/web && bun run dev`
Expected: App loads with chat sidebar on the right

**Step 3: Commit**

```bash
git add packages/web/src/Dashboard.tsx
git commit -m "feat(web): integrate ChatSidebar into Dashboard layout"
```

---

## Task 10: Manual Testing & Polish

**Step 1: Test with real data**

Run: `cd packages/cli && bun run dev open`
- Verify sidebar shows messages
- Verify clicking a message expands it
- Verify time range selection filters messages
- Verify multiple agents show split panes
- Verify resize handle works
- Verify collapse/expand works

**Step 2: Fix any visual issues**

Adjust CSS as needed for:
- Scroll behavior
- Text overflow
- Mobile responsiveness (if applicable)

**Step 3: Final commit**

```bash
git add -A
git commit -m "polish: chat sidebar styling and fixes"
```

---

## Summary

10 tasks total:
1. Add ChatMessage types to shared package
2. Add getMessages repository method with tests
3. Add /api/messages endpoint with tests
4. Add chat sidebar CSS styles
5. Create ContentBlock component
6. Create ChatMessageItem component
7. Create AgentPane component
8. Create ChatSidebar component
9. Integrate ChatSidebar into Dashboard
10. Manual testing and polish
