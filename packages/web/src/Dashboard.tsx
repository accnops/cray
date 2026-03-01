import { useState, useEffect, useMemo } from "react";
import type { Session } from "@ccray/shared";
import { useApi } from "./hooks/useApi";
import { SessionFilter } from "./components/SessionFilter";
import { TokensChart } from "./components/TokensChart";
import { TimeBreakdown } from "./components/TimeBreakdown";

function getProjectName(path: string): string {
  if (!path) return "";
  // Remove trailing slashes and get last path component
  const trimmed = path.replace(/\/+$/, "");
  const parts = trimmed.split("/");
  const last = parts[parts.length - 1];
  if (!last) return "";
  // Claude encodes paths like -Users-arthurcnops-Personal-projectname
  const cleaned = last.replace(/^-+/, "");
  return cleaned.split("-").pop() || cleaned || "";
}

interface AggregateData {
  totals: {
    cost: number;
    inputTokens: number;
    outputTokens: number;
    cacheReadTokens: number;
    durationMs: number;
  };
  tokensOverTime: Array<{
    ts: number;
    inputTokens: number;
    outputTokens: number;
    cacheReadTokens: number;
  }>;
  timeBreakdown: Array<{
    name: string;
    type: "llm" | "builtin" | "mcp";
    calls: number;
    totalMs: number;
    wallClockMs: number;
    pctOfSession: number;
    avgMs: number;
    p95Ms: number;
    errors: number;
  }>;
}

export function Dashboard() {
  const { data: sessions } = useApi<Session[]>("/api/sessions");
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [timeRange, setTimeRange] = useState<{ start: number; end: number } | null>(null);

  // Select all sessions by default
  useEffect(() => {
    if (sessions && selectedIds.length === 0) {
      setSelectedIds(sessions.map((s) => s.sessionId));
    }
  }, [sessions]);

  const projectTitle = useMemo(() => {
    if (!sessions || selectedIds.length === 0) return null;
    const selected = sessions.filter((s) => selectedIds.includes(s.sessionId));
    const projects = [...new Set(selected.map((s) => getProjectName(s.projectPath)))].filter(Boolean);
    if (projects.length === 0) return null;
    if (projects.length === 1) return projects[0];
    if (projects.length <= 3) return projects.join(", ");
    return `${projects.length} projects`;
  }, [sessions, selectedIds]);

  const queryString = useMemo(() => {
    const params = new URLSearchParams();
    if (selectedIds.length > 0) {
      params.set("sessions", selectedIds.join(","));
    }
    if (timeRange) {
      params.set("startTime", timeRange.start.toString());
      params.set("endTime", timeRange.end.toString());
    }
    const str = params.toString();
    return str ? `?${str}` : "";
  }, [selectedIds, timeRange]);

  // Reset zoom when sessions change
  useEffect(() => {
    setTimeRange(null);
  }, [selectedIds]);

  const { data: aggregate, loading } = useApi<AggregateData>(
    `/api/aggregate${queryString}`
  );

  if (!sessions) {
    return <div className="loading">Loading...</div>;
  }

  return (
    <div className="dashboard">
      <header className="dashboard-header">
        <div className="header-left">
          <h1>ccray</h1>
        </div>
        <div className="header-center">
          {projectTitle && <span className="project-title">{projectTitle}</span>}
          <SessionFilter
            sessions={sessions}
            selectedIds={selectedIds}
            onChange={setSelectedIds}
          />
        </div>
        <div className="header-right">
          {aggregate && (
            <div className="totals">
              {timeRange && (
                <span className="total-item date-range">
                  {formatDateRange(timeRange.start, timeRange.end)}
                </span>
              )}
              <span className="total-item">
                <strong>{formatNumber(aggregate.totals.inputTokens + aggregate.totals.outputTokens)}</strong> tokens
              </span>
            </div>
          )}
        </div>
      </header>

      <main className="dashboard-main">
        {loading ? (
          <div className="loading">Loading data...</div>
        ) : aggregate ? (
          <>
            <section className="panel">
              <h2>Tokens Over Time</h2>
              <TokensChart
                data={aggregate.tokensOverTime}
                onZoomChange={setTimeRange}
                isZoomed={timeRange !== null}
              />
            </section>

            <section className="panel">
              <h2>Time Breakdown</h2>
              <TimeBreakdown data={aggregate.timeBreakdown} sessionDurationMs={aggregate.totals.durationMs} />
            </section>
          </>
        ) : null}
      </main>
    </div>
  );
}

function formatNumber(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return n.toString();
}

function formatDateRange(start: number, end: number): string {
  const startDate = new Date(start);
  const endDate = new Date(end);
  const sameDay = startDate.toDateString() === endDate.toDateString();

  if (sameDay) {
    return `${startDate.toLocaleDateString()} ${startDate.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} - ${endDate.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
  }
  return `${startDate.toLocaleDateString()} - ${endDate.toLocaleDateString()}`;
}

