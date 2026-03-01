import { useState } from "react";
import type { ChatMessage, ChatContentBlock } from "@ccray/shared";
import { ContentBlock } from "./ContentBlock";

interface ChatMessageItemProps {
  message: ChatMessage;
  agentLabel?: string;
}

function ellipsis(str: string, max: number): string {
  if (str.length <= max) return str;
  return str.slice(0, max) + "...";
}

function getToolDetail(block: ChatContentBlock): string | null {
  if (block.type !== "tool_use") return null;

  const input = block.input as Record<string, unknown>;
  const name = block.toolName;

  // Extract relevant detail based on tool name
  switch (name) {
    case "TaskCreate":
      return input.subject ? ellipsis(String(input.subject), 50) : null;

    case "Bash":
      return input.command ? ellipsis(String(input.command), 60) : null;

    case "Read":
    case "Write":
    case "Edit":
      return input.file_path ? ellipsis(String(input.file_path), 50) : null;

    case "Glob":
      return input.pattern ? ellipsis(String(input.pattern), 40) : null;

    case "Grep":
      if (input.pattern) {
        const path = input.path ? ` in ${ellipsis(String(input.path), 30)}` : "";
        return ellipsis(String(input.pattern), 30) + path;
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
      return input.url ? ellipsis(String(input.url), 50) : null;

    case "WebSearch":
      return input.query ? ellipsis(String(input.query), 50) : null;

    case "Task":
      return input.description ? ellipsis(String(input.description), 50) : null;

    default:
      // For MCP tools, try common patterns
      if (name.startsWith("mcp__")) {
        if (input.path) return ellipsis(String(input.path), 50);
        if (input.query) return ellipsis(String(input.query), 50);
        if (input.url) return ellipsis(String(input.url), 50);
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

export function ChatMessageItem({ message, agentLabel }: ChatMessageItemProps) {
  const [expanded, setExpanded] = useState(false);

  const toolUseBlocks = message.content.filter((b) => b.type === "tool_use");
  const toolResultBlocks = message.content.filter((b) => b.type === "tool_result");
  const textBlocks = message.content.filter((b) => b.type === "text");
  const thinkingBlocks = message.content.filter((b) => b.type === "thinking");

  // Get preview text
  const firstText = textBlocks[0];
  const previewText = firstText?.type === "text" ? firstText.text : "";

  // Get first tool info
  const firstTool = toolUseBlocks[0];
  const toolName = firstTool?.type === "tool_use" ? formatToolName(firstTool.toolName) : null;
  const toolDetail = firstTool ? getToolDetail(firstTool) : null;

  const timeStr = new Date(message.ts).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
  });

  const isUser = message.role === "user";
  const hasExpandableContent = toolUseBlocks.length > 0 || toolResultBlocks.length > 0 ||
    thinkingBlocks.length > 0 || previewText.length > 120;

  // For tool results, show truncated output
  const firstResult = toolResultBlocks[0];
  const resultPreview = firstResult?.type === "tool_result"
    ? ellipsis(firstResult.output.replace(/\n/g, " "), 80)
    : null;

  return (
    <div
      className={`chat-message ${message.role} ${expanded ? "expanded" : ""} ${!hasExpandableContent ? "simple" : ""}`}
      onClick={hasExpandableContent ? () => setExpanded(!expanded) : undefined}
    >
      <div className="message-line">
        <span className="message-time">{timeStr}</span>
        <span className={`message-role ${message.role}`}>
          {isUser ? "You" : "Claude"}
        </span>
        {agentLabel && (
          <span className={`agent-badge ${message.agentKind}`}>{agentLabel}</span>
        )}

        {!expanded && (
          <span className="message-inline-content">
            {isUser && previewText ? (
              // User message - always show text
              <span className="inline-text">{ellipsis(previewText, 100)}</span>
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
              // Assistant text
              <span className="inline-text">{ellipsis(previewText, 100)}</span>
            ) : null}
          </span>
        )}

        {!expanded && hasExpandableContent && (
          <span className="expand-hint">▼</span>
        )}
      </div>

      {expanded && (
        <div className="message-content">
          {message.content.map((block, i) => (
            <ContentBlock key={i} block={block} />
          ))}
        </div>
      )}
    </div>
  );
}
