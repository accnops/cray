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
