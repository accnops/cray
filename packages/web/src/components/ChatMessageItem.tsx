import { useState } from "react";
import type { ChatMessage } from "@ccray/shared";
import { ContentBlock } from "./ContentBlock";

interface ChatMessageItemProps {
  message: ChatMessage;
  agentLabel?: string;
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

  // Get first tool name if any
  const firstTool = toolUseBlocks[0];
  const toolName = firstTool?.type === "tool_use" ? firstTool.toolName : null;

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
    ? firstResult.output.slice(0, 60) + (firstResult.output.length > 60 ? "..." : "")
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
            {previewText ? (
              <span className="inline-text">
                {previewText.slice(0, 100)}{previewText.length > 100 ? "..." : ""}
              </span>
            ) : toolName ? (
              <span className="inline-tool">
                {toolName.replace("mcp__", "").replace(/__/g, ":")}
                {toolUseBlocks.length > 1 && ` +${toolUseBlocks.length - 1}`}
              </span>
            ) : resultPreview ? (
              <span className="inline-result">{resultPreview}</span>
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
