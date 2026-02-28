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
