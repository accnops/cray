import type { Session } from "@ccray/shared";
import { useApi } from "../hooks/useApi";
import { SessionTable } from "../components/SessionTable";

export function SessionExplorer() {
  const { data: sessions, loading, error } = useApi<Session[]>("/api/sessions");

  if (loading) {
    return <div className="loading">Loading sessions...</div>;
  }

  if (error) {
    return <div className="error">Error: {error.message}</div>;
  }

  if (!sessions || sessions.length === 0) {
    return (
      <div className="empty-state">
        <h2>No sessions found</h2>
        <p>Run ccray with a path to Claude Code session files.</p>
      </div>
    );
  }

  return (
    <div className="session-explorer">
      <h2>Sessions ({sessions.length})</h2>
      <SessionTable sessions={sessions} />
    </div>
  );
}
