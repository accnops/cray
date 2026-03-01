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
