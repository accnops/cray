import { useParams } from "react-router-dom";
import type { Session, Span } from "@ccray/shared";
import { useApi } from "../hooks/useApi";

export function SessionView() {
  const { id } = useParams<{ id: string }>();
  const { data: session, loading: sessionLoading } = useApi<Session>(`/api/sessions/${id}`);
  const { data: spans, loading: spansLoading } = useApi<Span[]>(`/api/sessions/${id}/spans`);

  if (sessionLoading || spansLoading) {
    return <div className="loading">Loading session...</div>;
  }

  if (!session) {
    return <div className="error">Session not found</div>;
  }

  return (
    <div className="session-view">
      <h2>Session: {session.sessionId.slice(0, 8)}...</h2>
      <div className="session-meta">
        <span>Duration: {(session.durationMs / 1000).toFixed(1)}s</span>
        <span>Cost: ${session.estimatedCostUsd.toFixed(4)}</span>
        <span>Tokens: {session.totalInputTokens.toLocaleString()} in / {session.totalOutputTokens.toLocaleString()} out</span>
      </div>

      <h3>Spans ({spans?.length ?? 0})</h3>
      <div className="timeline-placeholder">
        Timeline visualization will be implemented with PixiJS
      </div>
    </div>
  );
}
