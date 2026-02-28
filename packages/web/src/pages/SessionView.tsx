import { useParams, Link } from "react-router-dom";
import type { Session, Span } from "@ccray/shared";
import { useApi } from "../hooks/useApi";
import { ToolProfiler } from "../components/ToolProfiler";

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
      <nav className="breadcrumb">
        <Link to="/">Sessions</Link> / {session.sessionId.slice(0, 8)}...
      </nav>

      <h2>Session Details</h2>
      <div className="session-meta">
        <div className="meta-item">
          <span className="label">Duration</span>
          <span className="value">{(session.durationMs / 1000).toFixed(1)}s</span>
        </div>
        <div className="meta-item">
          <span className="label">Cost</span>
          <span className="value">${session.estimatedCostUsd.toFixed(4)}</span>
        </div>
        <div className="meta-item">
          <span className="label">Input Tokens</span>
          <span className="value">{session.totalInputTokens.toLocaleString()}</span>
        </div>
        <div className="meta-item">
          <span className="label">Output Tokens</span>
          <span className="value">{session.totalOutputTokens.toLocaleString()}</span>
        </div>
        <div className="meta-item">
          <span className="label">Cache Read</span>
          <span className="value">{session.totalCacheReadTokens.toLocaleString()}</span>
        </div>
      </div>

      <section className="section">
        <h3>Timeline ({spans?.length ?? 0} spans)</h3>
        <div className="timeline-placeholder">
          Timeline visualization will be implemented with PixiJS
        </div>
      </section>

      <section className="section">
        <h3>Tool Profiler</h3>
        <ToolProfiler sessionId={session.sessionId} />
      </section>
    </div>
  );
}
