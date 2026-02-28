import type { ToolStats } from "@ccray/db";
import { useApi } from "../hooks/useApi";

interface Props {
  sessionId: string;
}

export function ToolProfiler({ sessionId }: Props) {
  const { data: stats, loading, error } = useApi<ToolStats[]>(
    `/api/sessions/${sessionId}/tools`
  );

  if (loading) return <div className="loading">Loading tool stats...</div>;
  if (error) return <div className="error">Error loading tools</div>;
  if (!stats || stats.length === 0) return <div>No tool calls found</div>;

  return (
    <div className="tool-profiler">
      <table className="tool-table">
        <thead>
          <tr>
            <th>Tool</th>
            <th>Family</th>
            <th>Calls</th>
            <th>Total Time</th>
            <th>Avg</th>
            <th>P95</th>
            <th>Max</th>
            <th>Errors</th>
            <th>I/O Bytes</th>
          </tr>
        </thead>
        <tbody>
          {stats.map((tool) => (
            <tr key={`${tool.toolName}-${tool.mcpServer ?? ""}`}>
              <td className="tool-name">
                {tool.mcpServer ? `${tool.mcpServer}::${tool.toolName}` : tool.toolName}
              </td>
              <td>
                <span className={`badge badge-${tool.toolFamily}`}>
                  {tool.toolFamily}
                </span>
              </td>
              <td>{tool.callCount}</td>
              <td>{formatMs(tool.totalDurationMs)}</td>
              <td>{formatMs(tool.avgDurationMs)}</td>
              <td>{formatMs(tool.p95DurationMs)}</td>
              <td>{formatMs(tool.maxDurationMs)}</td>
              <td className={tool.errorCount > 0 ? "has-errors" : ""}>
                {tool.errorCount} ({(tool.errorRate * 100).toFixed(1)}%)
              </td>
              <td>
                {formatBytes(tool.totalInputBytes)} / {formatBytes(tool.totalOutputBytes)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function formatMs(ms: number): string {
  if (ms < 1000) return `${ms.toFixed(0)}ms`;
  return `${(ms / 1000).toFixed(2)}s`;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)}MB`;
}
