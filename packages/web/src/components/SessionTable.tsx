import { Link } from "react-router-dom";
import type { Session } from "@ccray/shared";

interface Props {
  sessions: Session[];
}

export function SessionTable({ sessions }: Props) {
  return (
    <table className="session-table">
      <thead>
        <tr>
          <th>Session</th>
          <th>Project</th>
          <th>Duration</th>
          <th>Tokens (In/Out)</th>
          <th>Cost</th>
          <th>Started</th>
        </tr>
      </thead>
      <tbody>
        {sessions.map((s) => (
          <tr key={s.sessionId}>
            <td>
              <Link to={`/session/${s.sessionId}`}>
                {s.sessionId.slice(0, 8)}...
              </Link>
            </td>
            <td className="project-path">{s.projectPath.split("/").pop()}</td>
            <td>{formatDuration(s.durationMs)}</td>
            <td>
              {s.totalInputTokens.toLocaleString()} / {s.totalOutputTokens.toLocaleString()}
            </td>
            <td>${s.estimatedCostUsd.toFixed(4)}</td>
            <td>{formatDate(s.startTs)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function formatDuration(ms: number): string {
  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  if (minutes > 0) {
    return `${minutes}m ${seconds % 60}s`;
  }
  return `${seconds}s`;
}

function formatDate(ts: number): string {
  return new Date(ts).toLocaleString();
}
