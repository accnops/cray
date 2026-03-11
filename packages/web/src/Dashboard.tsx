import { useState, useEffect, useMemo } from "react";
import type { Session } from "@cray/shared";
import { useApi } from "./hooks/useApi";
import { SessionFilter } from "./components/SessionFilter";
import { HandDrawnChart } from "./components/HandDrawnChart";
import { TimeBreakdown } from "./components/TimeBreakdown";
import { ChatSidebar } from "./components/ChatSidebar";
import { Logo } from "./components/Logo";

interface DashboardProps {
  projectName?: string;
  showBackButton?: boolean;
  onBack?: () => void;
}

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

export function Dashboard({ projectName: propProjectName, showBackButton, onBack }: DashboardProps) {
  const { data: sessions } = useApi<Session[]>("/api/sessions");
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [timeRange, setTimeRange] = useState<{ start: number; end: number } | null>(null);
  const [indicatorTs, setIndicatorTs] = useState<number | null>(null);
  const [scrollToTs, setScrollToTs] = useState<number | null>(null);

  // Select all sessions by default
  useEffect(() => {
    if (sessions && selectedIds.length === 0) {
      setSelectedIds(sessions.map((s) => s.sessionId));
    }
  }, [sessions]);

  const projectTitle = useMemo(() => {
    // Use prop if provided
    if (propProjectName) return propProjectName;

    if (!sessions || selectedIds.length === 0) return null;
    const selected = sessions.filter((s) => selectedIds.includes(s.sessionId));
    const projects = [...new Set(selected.map((s) => getProjectName(s.projectPath)))].filter(Boolean);
    if (projects.length === 0) return null;
    if (projects.length === 1) return projects[0];
    if (projects.length <= 3) return projects.join(", ");
    return `${projects.length} projects`;
  }, [propProjectName, sessions, selectedIds]);

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
      <div className="main-panel">
        <header className="dashboard-header">
          <div className="header-left">
            {showBackButton && onBack ? (
              <button className="back-button" onClick={onBack} title="Back to projects">
                <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
                  <path d="M10.5 3L5.5 8L10.5 13" stroke="currentColor" strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round"/>
                </svg>
              </button>
            ) : null}
            <Logo size={18} />
            {projectTitle && <span className="project-title">{projectTitle}</span>}
          </div>
          <div className="header-center">
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

        <main className="main-content">
          {loading ? (
            <div className="loading">Loading data...</div>
          ) : aggregate ? (
            <>
              <section className="panel">
                <h2>Tokens Over Time</h2>
                <HandDrawnChart
                  data={aggregate.tokensOverTime}
                  onZoomChange={setTimeRange}
                  onTimeClick={setScrollToTs}
                  isZoomed={timeRange !== null}
                  indicatorTs={indicatorTs}
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

      <ChatSidebar sessionIds={selectedIds} timeRange={timeRange} onIndicatorChange={setIndicatorTs} scrollToTs={scrollToTs} />
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

