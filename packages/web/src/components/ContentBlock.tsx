import { useState } from "react";
import type { ChatContentBlock } from "@cray/shared";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { ToolInputDisplay } from "./ToolInputDisplay";

interface ContentBlockProps {
  block: ChatContentBlock;
}

function CollapsibleThinking({ text }: { text: string }) {
  const [isExpanded, setIsExpanded] = useState(false);
  const charCount = text.length;
  const previewLength = 150;
  const needsCollapse = charCount > previewLength;
  const preview = needsCollapse ? text.slice(0, previewLength) + "..." : text;

  if (!needsCollapse) {
    return <div className="content-block thinking-block">{text}</div>;
  }

  return (
    <div className={`content-block thinking-block collapsible ${isExpanded ? "expanded" : ""}`}>
      <div
        className="thinking-header"
        onClick={() => setIsExpanded(!isExpanded)}
      >
        <span className="thinking-toggle">{isExpanded ? "▼" : "▶"}</span>
        <span className="thinking-label">Thinking</span>
        <span className="thinking-badge">{charCount.toLocaleString()} chars</span>
      </div>
      <div className="thinking-content">
        {isExpanded ? text : preview}
      </div>
    </div>
  );
}

export function ContentBlock({ block }: ContentBlockProps) {
  if (block.type === "text") {
    return (
      <div className="content-block text-block">
        <Markdown remarkPlugins={[remarkGfm]}>{block.text}</Markdown>
      </div>
    );
  }

  if (block.type === "thinking") {
    return <CollapsibleThinking text={block.text} />;
  }

  if (block.type === "tool_use") {
    const isMcp = block.toolName.startsWith("mcp__");
    return (
      <div className="content-block tool-use-block">
        <div className="tool-use-header">
          <span className={`tool-name ${isMcp ? "mcp" : ""}`}>{block.toolName}</span>
        </div>
        <ToolInputDisplay toolName={block.toolName} input={block.input} />
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

  if (block.type === "system") {
    return (
      <div className="content-block system-block">
        {block.text}
      </div>
    );
  }

  return null;
}
