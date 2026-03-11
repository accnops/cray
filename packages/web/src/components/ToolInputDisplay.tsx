import { useState } from "react";

interface ToolInputDisplayProps {
  toolName: string;
  input: unknown;
}

const TRUNCATE_THRESHOLD = 500;

function formatPath(path: string): JSX.Element {
  return <span className="tool-path">{path}</span>;
}

function TruncatedText({ text, threshold = TRUNCATE_THRESHOLD }: { text: string; threshold?: number }) {
  const [isExpanded, setIsExpanded] = useState(false);
  const needsTruncation = text.length > threshold;

  if (!needsTruncation) {
    return <>{text}</>;
  }

  return (
    <>
      {isExpanded ? text : text.slice(0, threshold) + "..."}
      <button
        className="tool-show-more"
        onClick={(e) => {
          e.stopPropagation();
          setIsExpanded(!isExpanded);
        }}
      >
        {isExpanded ? "Show less" : "Show more"}
      </button>
    </>
  );
}

function BashDisplay({ input }: { input: Record<string, unknown> }) {
  const command = input.command as string | undefined;
  const description = input.description as string | undefined;

  return (
    <div className="tool-input-formatted">
      {description && (
        <div className="tool-description">{description}</div>
      )}
      {command && (
        <pre className="tool-command">
          <code>
            <TruncatedText text={command} />
          </code>
        </pre>
      )}
    </div>
  );
}

function EditDisplay({ input }: { input: Record<string, unknown> }) {
  const filePath = input.file_path as string | undefined;
  const oldString = input.old_string as string | undefined;
  const newString = input.new_string as string | undefined;

  return (
    <div className="tool-input-formatted">
      {filePath && (
        <div className="tool-file-path">{formatPath(filePath)}</div>
      )}
      <div className="tool-diff">
        {oldString && (
          <div className="tool-diff-section">
            <span className="tool-diff-label remove">- old</span>
            <pre className="tool-diff-content remove">
              <TruncatedText text={oldString} threshold={300} />
            </pre>
          </div>
        )}
        {newString && (
          <div className="tool-diff-section">
            <span className="tool-diff-label add">+ new</span>
            <pre className="tool-diff-content add">
              <TruncatedText text={newString} threshold={300} />
            </pre>
          </div>
        )}
      </div>
    </div>
  );
}

function ReadDisplay({ input }: { input: Record<string, unknown> }) {
  const filePath = input.file_path as string | undefined;
  const offset = input.offset as number | undefined;
  const limit = input.limit as number | undefined;

  return (
    <div className="tool-input-formatted">
      {filePath && <div className="tool-file-path">{formatPath(filePath)}</div>}
      {(offset !== undefined || limit !== undefined) && (
        <div className="tool-meta">
          {offset !== undefined && <span>offset: {offset}</span>}
          {limit !== undefined && <span>limit: {limit}</span>}
        </div>
      )}
    </div>
  );
}

function WriteDisplay({ input }: { input: Record<string, unknown> }) {
  const filePath = input.file_path as string | undefined;
  const content = input.content as string | undefined;

  return (
    <div className="tool-input-formatted">
      {filePath && <div className="tool-file-path">{formatPath(filePath)}</div>}
      {content && (
        <pre className="tool-content-preview">
          <TruncatedText text={content} threshold={400} />
        </pre>
      )}
    </div>
  );
}

function GlobDisplay({ input }: { input: Record<string, unknown> }) {
  const pattern = input.pattern as string | undefined;
  const path = input.path as string | undefined;

  return (
    <div className="tool-input-formatted">
      {pattern && (
        <div className="tool-pattern">
          <span className="tool-pattern-label">pattern:</span>
          <code>{pattern}</code>
        </div>
      )}
      {path && <div className="tool-file-path">{formatPath(path)}</div>}
    </div>
  );
}

function GrepDisplay({ input }: { input: Record<string, unknown> }) {
  const pattern = input.pattern as string | undefined;
  const path = input.path as string | undefined;
  const glob = input.glob as string | undefined;

  return (
    <div className="tool-input-formatted">
      {pattern && (
        <div className="tool-pattern">
          <span className="tool-pattern-label">pattern:</span>
          <code>{pattern}</code>
        </div>
      )}
      {path && <div className="tool-file-path">{formatPath(path)}</div>}
      {glob && (
        <div className="tool-meta">
          <span>glob: {glob}</span>
        </div>
      )}
    </div>
  );
}

function JsonDisplay({ input }: { input: unknown }) {
  const [isExpanded, setIsExpanded] = useState(false);
  const jsonString = JSON.stringify(input, null, 2);
  const needsCollapse = jsonString.length > 200;

  if (!needsCollapse) {
    return <pre className="tool-json">{jsonString}</pre>;
  }

  return (
    <div className="tool-json-collapsible">
      <div
        className="tool-json-header"
        onClick={() => setIsExpanded(!isExpanded)}
      >
        <span className="tool-json-toggle">{isExpanded ? "▼" : "▶"}</span>
        <span className="tool-json-preview">
          {isExpanded ? "JSON" : jsonString.slice(0, 60) + "..."}
        </span>
      </div>
      {isExpanded && (
        <pre className="tool-json">
          <TruncatedText text={jsonString} threshold={1000} />
        </pre>
      )}
    </div>
  );
}

export function ToolInputDisplay({ toolName, input }: ToolInputDisplayProps) {
  if (typeof input === "string") {
    return <div className="tool-input"><TruncatedText text={input} /></div>;
  }

  if (typeof input !== "object" || input === null) {
    return <div className="tool-input">{String(input)}</div>;
  }

  const inputObj = input as Record<string, unknown>;

  // Handle specific tools
  if (toolName === "Bash") {
    return <BashDisplay input={inputObj} />;
  }

  if (toolName === "Edit") {
    return <EditDisplay input={inputObj} />;
  }

  if (toolName === "Read") {
    return <ReadDisplay input={inputObj} />;
  }

  if (toolName === "Write") {
    return <WriteDisplay input={inputObj} />;
  }

  if (toolName === "Glob") {
    return <GlobDisplay input={inputObj} />;
  }

  if (toolName === "Grep") {
    return <GrepDisplay input={inputObj} />;
  }

  // Default: JSON display with collapse for long content
  return <JsonDisplay input={input} />;
}
