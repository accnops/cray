# Chat Sidebar Design Document

**Date:** 2026-03-01
**Status:** Approved

## Overview

Add a chat sidebar to ccray that displays the conversation for the selected time window. The sidebar shows messages from all agents, with split panes when multiple subagents run in parallel.

**Key requirements:**
- Show all messages (scrollable) when no time range selected
- Split panes when multiple agents active in the selected window
- Messages collapsed by default, click to expand
- Fixed-width right sidebar, resizable and collapsible

---

## Data Model

### New Types (`@ccray/shared/src/types.ts`)

```typescript
export interface ChatMessage {
  eventId: string;
  agentId: string;
  agentKind: "main" | "subagent";
  ts: number;
  role: "user" | "assistant";
  content: ChatContentBlock[];
}

export type ChatContentBlock =
  | { type: "text"; text: string }
  | { type: "thinking"; text: string }
  | { type: "tool_use"; toolName: string; toolId: string; input: unknown }
  | { type: "tool_result"; toolId: string; output: string; isError: boolean };

export interface AgentInfo {
  agentId: string;
  kind: "main" | "subagent";
  label: string;
}
```

---

## API

### New Endpoint

```
GET /api/messages?sessions=<ids>&startTime=<ts>&endTime=<ts>
```

**Response:**
```typescript
{
  messages: ChatMessage[];
  agents: AgentInfo[];
}
```

### Server-Side Parsing (`@ccray/db/src/repository.ts`)

New method `getMessages(sessionIds, startTime?, endTime?)`:
1. Query `events` table filtered by session IDs and optional time range
2. Filter to `raw_type IN ('user', 'assistant', 'result')`
3. Parse each `raw_json` into structured `ChatMessage`
4. Extract content blocks from assistant messages
5. Match tool results to their tool_use by `toolId`
6. Return unique agents list from the messages

### Message Parsing Logic

For `type: "user"` events:
- Extract text from `message.content` array

For `type: "assistant"` events:
- Parse `message.content` array
- Map each block: `text` → text block, `thinking` → thinking block, `tool_use` → tool_use block

For `type: "result"` events:
- Extract `toolUseResult.content` as output
- Check `toolUseResult.is_error` for error state
- Link to tool_use via `toolUseResult.tool_use_id`

---

## UI Layout

```
┌─────────────────────────────────────────────────────────────────────────┐
│  Header                                                                 │
├───────────────────────────────────────────────────┬─────────────────────┤
│  Main Content (flex: 1)                           │  Chat Sidebar       │
│  ┌─────────────────────────────────────────────┐  │  (width: 400px)     │
│  │ Tokens Over Time                            │  │                     │
│  └─────────────────────────────────────────────┘  │  ┌───────┬───────┐  │
│  ┌─────────────────────────────────────────────┐  │  │ Main  │ Sub-1 │  │
│  │ Time Breakdown                              │  │  │       │       │  │
│  └─────────────────────────────────────────────┘  │  │ msgs  │ msgs  │  │
│                                                   │  │       │       │  │
│                                                   │  └───────┴───────┘  │
└───────────────────────────────────────────────────┴─────────────────────┘
```

### CSS Layout Changes

- `.dashboard-main` becomes a flex row with `main-content` and `chat-sidebar`
- Main content area uses `flex: 1` to fill remaining space
- Sidebar has fixed width (400px default) with resize handle on left edge

---

## Components

### `ChatSidebar` (`packages/web/src/components/ChatSidebar.tsx`)

Container component for the entire sidebar.

**Props:**
```typescript
interface ChatSidebarProps {
  sessionIds: string[];
  timeRange: { start: number; end: number } | null;
}
```

**Responsibilities:**
- Fetch messages via `useApi('/api/messages?...')`
- Group messages by agent
- Render resize handle (drag to resize width)
- Render collapse toggle button
- Render `AgentPane` for each active agent

**State:**
- `width: number` (persisted to localStorage)
- `collapsed: boolean`

### `AgentPane` (`packages/web/src/components/AgentPane.tsx`)

Scrollable pane for one agent's messages.

**Props:**
```typescript
interface AgentPaneProps {
  agent: AgentInfo;
  messages: ChatMessage[];
}
```

**Features:**
- Sticky header with agent label
- Virtualized scroll for performance (react-window or native with intersection observer)
- Auto-scroll to bottom option

### `ChatMessage` (`packages/web/src/components/ChatMessage.tsx`)

Individual message display.

**Props:**
```typescript
interface ChatMessageProps {
  message: ChatMessage;
  expanded: boolean;
  onToggle: () => void;
}
```

**Collapsed state:**
- Role icon (user/assistant)
- First line of text (truncated to ~60 chars)
- Tool badge showing count if has tool_use blocks
- Timestamp

**Expanded state:**
- Full content blocks rendered
- Code/JSON syntax highlighted
- Tool inputs/outputs shown

### `ContentBlock` (`packages/web/src/components/ContentBlock.tsx`)

Renders a single content block.

**Text block:**
- Render as markdown (or plain text for MVP)
- Preserve whitespace for code

**Thinking block:**
- Italic, muted color (`var(--text-secondary)`)
- Collapsible (default collapsed within expanded message)

**Tool use block:**
- Tool name as badge (colored by type: builtin blue, mcp purple)
- Input JSON collapsible, syntax highlighted

**Tool result block:**
- Output text (truncated if very long, expandable)
- Error styling (red border) if `isError`

---

## Styling

### New CSS Variables

```css
:root {
  --sidebar-width: 400px;
  --sidebar-min-width: 300px;
  --sidebar-max-width: 600px;
  --message-user-bg: rgba(88, 166, 255, 0.1);
  --message-border-radius: 8px;
}
```

### Key Styles

```css
.chat-sidebar {
  width: var(--sidebar-width);
  min-width: var(--sidebar-min-width);
  max-width: var(--sidebar-max-width);
  border-left: 1px solid var(--border);
  background: var(--bg-secondary);
  display: flex;
  flex-direction: column;
}

.chat-sidebar.collapsed {
  width: 40px;
  min-width: 40px;
}

.agent-pane {
  flex: 1;
  overflow-y: auto;
  border-right: 1px solid var(--border);
}

.agent-pane:last-child {
  border-right: none;
}

.agent-pane-header {
  position: sticky;
  top: 0;
  background: var(--bg-tertiary);
  padding: 0.5rem;
  font-weight: 500;
  border-bottom: 1px solid var(--border);
}

.chat-message {
  padding: 0.75rem;
  border-bottom: 1px solid var(--border);
  cursor: pointer;
}

.chat-message:hover {
  background: var(--bg-tertiary);
}

.chat-message.user {
  background: var(--message-user-bg);
}

.chat-message.expanded {
  cursor: default;
}

.message-preview {
  display: flex;
  align-items: center;
  gap: 0.5rem;
}

.message-content {
  font-size: 0.875rem;
  line-height: 1.5;
}

.tool-badge {
  display: inline-flex;
  align-items: center;
  gap: 0.25rem;
  padding: 0.125rem 0.5rem;
  border-radius: 9999px;
  font-size: 0.75rem;
  font-weight: 500;
}

.thinking-block {
  font-style: italic;
  color: var(--text-secondary);
  border-left: 2px solid var(--border);
  padding-left: 0.75rem;
  margin: 0.5rem 0;
}

.tool-use-block, .tool-result-block {
  margin: 0.5rem 0;
  padding: 0.5rem;
  background: var(--bg-tertiary);
  border-radius: 4px;
  font-family: monospace;
  font-size: 0.8rem;
}

.tool-result-block.error {
  border-left: 3px solid var(--error);
}
```

---

## Error Handling

- **Empty state**: Show "No messages in selected range" when no messages
- **Loading state**: Show spinner in sidebar while fetching
- **API errors**: Show error message with retry button
- **Parse errors**: Skip malformed events, log warning to console

---

## Performance Considerations

- **Virtualization**: For conversations with 100+ messages, use windowed rendering
- **Debounced resize**: Throttle sidebar resize to avoid layout thrashing
- **Memoization**: Memoize message grouping by agent
- **Lazy expansion**: Don't parse/render tool inputs until message expanded

---

## Future Enhancements (Not in MVP)

- Search within chat
- Copy message/block to clipboard
- Jump to message from timeline click
- Highlight messages related to selected span
- Keyboard navigation (up/down arrows)
