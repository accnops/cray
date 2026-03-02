import { useState } from "react";
import type { ChatMessage, ChatContentBlock } from "@cray/shared";
import { ContentBlock } from "./ContentBlock";

interface ChatMessageItemProps {
  message: ChatMessage;
  agentLabel?: string;
}

function getToolDetail(block: ChatContentBlock): string | null {
  if (block.type !== "tool_use") return null;

  const input = block.input as Record<string, unknown>;
  const name = block.toolName;

  // Extract relevant detail based on tool name (CSS handles truncation)
  switch (name) {
    case "Bash":
      return input.command ? String(input.command) : null;

    case "Read":
    case "Write":
    case "Edit":
      return input.file_path ? String(input.file_path) : null;

    case "Glob":
      return input.pattern ? String(input.pattern) : null;

    case "Grep":
      if (input.pattern) {
        const path = input.path ? ` in ${String(input.path)}` : "";
        return String(input.pattern) + path;
      }
      return null;

    case "Skill":
      return input.skill ? String(input.skill) : null;

    case "AskUserQuestion": {
      const questions = input.questions as Array<{ header?: string }> | undefined;
      if (questions && questions.length > 0) {
        const headers = questions.map((q) => q.header).filter(Boolean);
        return headers.length > 0 ? headers.join(", ") : null;
      }
      return null;
    }

    case "WebFetch":
      return input.url ? String(input.url) : null;

    case "WebSearch":
      return input.query ? String(input.query) : null;

    default:
      // For MCP tools, try common patterns
      if (name.startsWith("mcp__")) {
        if (input.path) return String(input.path);
        if (input.query) return String(input.query);
        if (input.url) return String(input.url);
      }
      return null;
  }
}

function formatToolName(name: string): string {
  // mcp__server__tool -> server:tool
  if (name.startsWith("mcp__")) {
    return name.replace("mcp__", "").replace(/__/g, ":");
  }
  return name;
}

function isTaskOrTodoTool(name: string): boolean {
  return name.startsWith("Task") || name.startsWith("Todo");
}

function stripMarkdown(text: string): string {
  return text
    .replace(/\*\*(.+?)\*\*/g, "$1")  // **bold**
    .replace(/\*(.+?)\*/g, "$1")       // *italic*
    .replace(/__(.+?)__/g, "$1")       // __bold__
    .replace(/_(.+?)_/g, "$1")         // _italic_
    .replace(/`(.+?)`/g, "$1")         // `code`
    .replace(/^#{1,6}\s+/gm, "")       // # headers
    .replace(/^\s*[-*+]\s+/gm, "")     // - list items
    .replace(/^\s*\d+\.\s+/gm, "")     // 1. numbered lists
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1"); // [link](url)
}

export function ChatMessageItem({ message, agentLabel }: ChatMessageItemProps) {
  const [expanded, setExpanded] = useState(false);

  const toolUseBlocks = message.content.filter(
    (b) => b.type === "tool_use" && !isTaskOrTodoTool(b.toolName)
  );
  const toolResultBlocks = message.content.filter(
    (b) => b.type === "tool_result" && !isTaskOrTodoTool(b.toolName)
  );
  const textBlocks = message.content.filter((b) => b.type === "text");
  const thinkingBlocks = message.content.filter((b) => b.type === "thinking");

  // Get preview text - prefer text blocks, fall back to thinking
  const firstText = textBlocks[0];
  const firstThinking = thinkingBlocks[0];
  const previewText = firstText?.type === "text"
    ? firstText.text
    : firstThinking?.type === "thinking"
      ? firstThinking.text
      : "";

  // Get first tool info
  const firstTool = toolUseBlocks[0];
  const toolName = firstTool?.type === "tool_use" ? formatToolName(firstTool.toolName) : null;
  const toolDetail = firstTool ? getToolDetail(firstTool) : null;

  const timeStr = new Date(message.ts).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
  });

  const isUser = message.role === "user";
  const isSystem = message.role === "system";
  const isThinkingOnly = textBlocks.length === 0 && thinkingBlocks.length > 0;
  // User messages are expandable if they have text (to see full message)
  // Assistant messages are expandable if they have tools, thinking, or long text
  // System messages are never expandable
  const hasExpandableContent = isSystem
    ? false
    : isUser
      ? textBlocks.length > 0
      : toolUseBlocks.length > 0 || toolResultBlocks.length > 0 ||
        thinkingBlocks.length > 0 || previewText.length > 120;

  // For tool results, show output (CSS handles truncation)
  const firstResult = toolResultBlocks[0];
  const resultPreview = firstResult?.type === "tool_result"
    ? firstResult.output.replace(/\n/g, " ")
    : null;

  return (
    <div
      className={`chat-message ${message.role} ${expanded ? "expanded" : ""} ${!hasExpandableContent ? "simple" : ""}`}
      data-ts={message.ts}
      onClick={hasExpandableContent ? () => setExpanded(!expanded) : undefined}
    >
      <div className="message-line">
        <span className="message-time">{timeStr}</span>
        <span className={`message-role ${message.role}`}>
          {isSystem ? "System" : isUser ? "You" : "Claude"}
        </span>
        {agentLabel && (
          <span className={`agent-badge ${message.agentKind}`}>{agentLabel}</span>
        )}

        {!expanded && (
          <span className="message-inline-content">
            {isSystem ? (
              // System message - show the system text
              <span className="inline-system">
                {message.content[0]?.type === "system" ? message.content[0].text : ""}
              </span>
            ) : isUser && previewText ? (
              // User message - always show text
              <span className="inline-text">{stripMarkdown(previewText)}</span>
            ) : toolName ? (
              // Tool call - show name + detail
              <span className="inline-tool">
                <span className="tool-name-part">{toolName}</span>
                {toolDetail && <span className="tool-detail-part">{toolDetail}</span>}
                {toolUseBlocks.length > 1 && (
                  <span className="tool-more">+{toolUseBlocks.length - 1}</span>
                )}
              </span>
            ) : resultPreview ? (
              // Tool result
              <span className="inline-result">{resultPreview}</span>
            ) : previewText ? (
              // Assistant text (or thinking if no text blocks)
              <span className={`inline-text ${isThinkingOnly ? "thinking" : ""}`}>{stripMarkdown(previewText)}</span>
            ) : null}
          </span>
        )}

        {!expanded && hasExpandableContent && (
          <span className="expand-hint">▼</span>
        )}
      </div>

      {expanded && (
        <div className="message-content">
          {message.content
            .filter((block) => {
              if (block.type === "tool_use" || block.type === "tool_result") {
                return !isTaskOrTodoTool(block.toolName);
              }
              return true;
            })
            .map((block, i) => (
              <ContentBlock key={i} block={block} />
            ))}
        </div>
      )}
    </div>
  );
}
