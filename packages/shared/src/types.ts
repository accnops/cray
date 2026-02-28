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
  firstMessage: string | null;
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
