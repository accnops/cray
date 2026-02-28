import { useState, useEffect, useMemo } from "react";
import type { Session } from "@ccray/shared";
import { useApi } from "./hooks/useApi";
import { SessionFilter } from "./components/SessionFilter";
import { TokensChart } from "./components/TokensChart";
import { TimeBreakdown } from "./components/TimeBreakdown";

interface AggregateData {
  totals: {
    cost: number;
    inputTokens: number;
    outputTokens: number;
    cacheReadTokens: number;
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
    avgMs: number;
    p95Ms: number;
    errors: number;
  }>;
}

export function Dashboard() {
  const { data: sessions } = useApi<Session[]>("/api/sessions");
  const [selectedIds, setSelectedIds] = useState<string[]>([]);

  // Select all sessions by default
  useEffect(() => {
    if (sessions && selectedIds.length === 0) {
      setSelectedIds(sessions.map((s) => s.sessionId));
    }
  }, [sessions]);

  const queryString = useMemo(() => {
    if (selectedIds.length === 0) return "";
    return `?sessions=${selectedIds.join(",")}`;
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
        <div className="header-right">
          <SessionFilter
            sessions={sessions}
            selectedIds={selectedIds}
            onChange={setSelectedIds}
          />
          {aggregate && (
            <div className="totals">
              <span className="total-item">
                <strong>${aggregate.totals.cost.toFixed(2)}</strong> cost
              </span>
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
              <TokensChart data={aggregate.tokensOverTime} />
            </section>

            <section className="panel">
              <h2>Time Breakdown</h2>
              <TimeBreakdown data={aggregate.timeBreakdown} />
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
