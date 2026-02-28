# Dashboard Redesign Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Replace multi-page UI with single-page Grafana-style dashboard showing tokens over time, time breakdown, and tool performance with session filtering.

**Architecture:** Single Dashboard component with filter state at top, two full-width panels (TokensChart, TimeBreakdown). New aggregate API endpoint returns data for selected sessions. Use ECharts for visualizations.

**Tech Stack:** React, Apache ECharts, Hono API, SQLite aggregation queries

---

## Phase 1: Backend - Aggregation API

### Task 1: Add first_message to sessions table

**Files:**
- Modify: `packages/db/src/schema.ts`
- Modify: `packages/db/src/repository.ts`
- Modify: `packages/shared/src/types.ts`

**Step 1: Update Session type**

`packages/shared/src/types.ts` - add field to Session interface:
```typescript
export interface Session {
  sessionId: string;
  projectPath: string;
  startTs: number;
  endTs: number;
  durationMs: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  totalCacheReadTokens: number;
  totalCacheWriteTokens: number;
  estimatedCostUsd: number;
  firstMessage: string | null; // NEW
}
```

**Step 2: Update schema**

`packages/db/src/schema.ts` - add column:
```sql
first_message TEXT
```

**Step 3: Update repository rowToSession**

`packages/db/src/repository.ts`:
```typescript
firstMessage: row.first_message as string | null,
```

**Step 4: Build packages**

```bash
cd packages/shared && pnpm build
cd ../db && pnpm build
```

**Step 5: Commit**

```bash
git add -A && git commit -m "feat(db): add first_message field to sessions"
```

---

### Task 2: Extract first message during ingestion

**Files:**
- Modify: `packages/parser/src/ingest.ts`

**Step 1: Extract first user message from events**

In `ingestSession()`, after parsing events, find first user message:
```typescript
// Find first user message
let firstMessage: string | null = null;
for (const event of events) {
  if (event.normType === "user_message") {
    const raw = JSON.parse(event.rawJson);
    if (raw.message?.content) {
      const content = raw.message.content;
      if (typeof content === "string") {
        firstMessage = content.slice(0, 100);
      } else if (Array.isArray(content)) {
        const textPart = content.find((p: any) => p.type === "text");
        if (textPart?.text) {
          firstMessage = textPart.text.slice(0, 100);
        }
      }
      break;
    }
  }
}
```

**Step 2: Add firstMessage to session object**

```typescript
const session: Session = {
  // ... existing fields ...
  firstMessage,
};
```

**Step 3: Update insertSession in repository**

`packages/db/src/repository.ts` - add first_message to INSERT:
```typescript
INSERT OR REPLACE INTO sessions (
  session_id, project_path, start_ts, end_ts, duration_ms,
  total_input_tokens, total_output_tokens, total_cache_read_tokens,
  total_cache_write_tokens, estimated_cost_usd, first_message
) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
```

**Step 4: Build and test**

```bash
pnpm build
rm ~/.cache/ccray/ccray.db
./dist/ccray open ~/.claude/projects/-Users-arthurcnops-Personal-ccray --no-browser
# Check API returns firstMessage
curl http://127.0.0.1:3333/api/sessions | jq '.[0].firstMessage'
```

**Step 5: Commit**

```bash
git add -A && git commit -m "feat(parser): extract first user message during ingestion"
```

---

### Task 3: Add aggregate API endpoint

**Files:**
- Modify: `packages/db/src/repository.ts`
- Modify: `packages/server/src/routes.ts`

**Step 1: Add getAggregate method to Repository**

`packages/db/src/repository.ts`:
```typescript
export interface AggregateData {
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

getAggregate(sessionIds: string[]): AggregateData {
  if (sessionIds.length === 0) {
    return { totals: { cost: 0, inputTokens: 0, outputTokens: 0, cacheReadTokens: 0 }, tokensOverTime: [], timeBreakdown: [] };
  }

  const placeholders = sessionIds.map(() => "?").join(",");

  // Totals
  const totalsStmt = this.db.prepare(`
    SELECT
      SUM(estimated_cost_usd) as cost,
      SUM(total_input_tokens) as input_tokens,
      SUM(total_output_tokens) as output_tokens,
      SUM(total_cache_read_tokens) as cache_read_tokens
    FROM sessions
    WHERE session_id IN (${placeholders})
  `);
  const totalsRow = totalsStmt.get(...sessionIds) as Record<string, number>;

  // Tokens over time (from spans with LLM activity)
  const tokensStmt = this.db.prepare(`
    SELECT
      start_ts as ts,
      input_tokens,
      output_tokens,
      cache_read_tokens
    FROM spans
    WHERE session_id IN (${placeholders})
      AND (input_tokens > 0 OR output_tokens > 0)
    ORDER BY start_ts ASC
  `);
  const tokensRows = tokensStmt.all(...sessionIds) as Array<{
    ts: number;
    input_tokens: number;
    output_tokens: number;
    cache_read_tokens: number;
  }>;

  // Time breakdown - LLM spans
  const llmStmt = this.db.prepare(`
    SELECT
      model,
      COUNT(*) as calls,
      SUM(duration_ms) as total_ms,
      AVG(duration_ms) as avg_ms,
      SUM(CASE WHEN status = 'error' THEN 1 ELSE 0 END) as errors
    FROM spans
    WHERE session_id IN (${placeholders})
      AND span_type = 'agent_llm_active'
    GROUP BY model
  `);
  const llmRows = llmStmt.all(...sessionIds) as Array<{
    model: string | null;
    calls: number;
    total_ms: number;
    avg_ms: number;
    errors: number;
  }>;

  // Time breakdown - tools (reuse existing logic)
  const toolStats = this.getToolStatsMulti(sessionIds);

  const timeBreakdown: AggregateData["timeBreakdown"] = [];

  // Add LLM
  for (const row of llmRows) {
    timeBreakdown.push({
      name: row.model ? `LLM (${row.model.split("-").slice(0, 3).join("-")})` : "LLM",
      type: "llm",
      calls: row.calls,
      totalMs: row.total_ms,
      avgMs: row.avg_ms,
      p95Ms: 0, // Would need sorted array for real p95
      errors: row.errors,
    });
  }

  // Add tools
  for (const tool of toolStats) {
    timeBreakdown.push({
      name: tool.mcpServer ? `${tool.mcpServer}::${tool.toolName}` : tool.toolName,
      type: tool.toolFamily === "mcp" ? "mcp" : "builtin",
      calls: tool.callCount,
      totalMs: tool.totalDurationMs,
      avgMs: tool.avgDurationMs,
      p95Ms: tool.p95DurationMs,
      errors: tool.errorCount,
    });
  }

  // Sort by totalMs DESC
  timeBreakdown.sort((a, b) => b.totalMs - a.totalMs);

  return {
    totals: {
      cost: totalsRow.cost ?? 0,
      inputTokens: totalsRow.input_tokens ?? 0,
      outputTokens: totalsRow.output_tokens ?? 0,
      cacheReadTokens: totalsRow.cache_read_tokens ?? 0,
    },
    tokensOverTime: tokensRows.map((r) => ({
      ts: r.ts,
      inputTokens: r.input_tokens,
      outputTokens: r.output_tokens,
      cacheReadTokens: r.cache_read_tokens,
    })),
    timeBreakdown,
  };
}

getToolStatsMulti(sessionIds: string[]): ToolStats[] {
  const placeholders = sessionIds.map(() => "?").join(",");
  const stmt = this.db.prepare(`
    SELECT
      tc.tool_name,
      tc.tool_family,
      tc.mcp_server,
      tc.status,
      tc.input_bytes,
      tc.output_bytes,
      s.duration_ms
    FROM tool_calls tc
    JOIN spans s ON tc.span_id = s.span_id
    WHERE tc.session_id IN (${placeholders})
    ORDER BY tc.tool_name, tc.tool_family, tc.mcp_server
  `);

  const rows = stmt.all(...sessionIds) as Array<{
    tool_name: string;
    tool_family: string;
    mcp_server: string | null;
    status: string;
    input_bytes: number;
    output_bytes: number;
    duration_ms: number;
  }>;

  // Same grouping logic as getToolStats
  const groups = new Map<string, typeof rows>();
  for (const row of rows) {
    const key = `${row.tool_name}|${row.tool_family}|${row.mcp_server ?? ""}`;
    const group = groups.get(key) ?? [];
    group.push(row);
    groups.set(key, group);
  }

  const stats: ToolStats[] = [];
  for (const [, group] of groups) {
    const first = group[0];
    const durations = group.map((r) => r.duration_ms).sort((a, b) => a - b);
    const callCount = group.length;
    const errorCount = group.filter((r) => r.status === "error").length;
    const totalDurationMs = durations.reduce((sum, d) => sum + d, 0);
    const totalInputBytes = group.reduce((sum, r) => sum + r.input_bytes, 0);
    const totalOutputBytes = group.reduce((sum, r) => sum + r.output_bytes, 0);

    stats.push({
      toolName: first.tool_name,
      toolFamily: first.tool_family,
      mcpServer: first.mcp_server,
      callCount,
      totalDurationMs,
      avgDurationMs: totalDurationMs / callCount,
      p50DurationMs: this.percentile(durations, 50),
      p95DurationMs: this.percentile(durations, 95),
      maxDurationMs: durations[durations.length - 1] ?? 0,
      errorCount,
      errorRate: errorCount / callCount,
      totalInputBytes,
      totalOutputBytes,
    });
  }

  stats.sort((a, b) => b.totalDurationMs - a.totalDurationMs);
  return stats;
}
```

**Step 2: Add API route**

`packages/server/src/routes.ts`:
```typescript
app.get("/api/aggregate", (c) => {
  const sessionIdsParam = c.req.query("sessions");
  const sessionIds = sessionIdsParam ? sessionIdsParam.split(",") : [];

  // If no sessions specified, use all
  const ids = sessionIds.length > 0 ? sessionIds : repo.listSessions().map(s => s.sessionId);

  const data = repo.getAggregate(ids);
  return c.json(data);
});
```

**Step 3: Build and test**

```bash
pnpm build
curl "http://127.0.0.1:3333/api/aggregate" | jq '.totals'
```

**Step 4: Commit**

```bash
git add -A && git commit -m "feat(api): add aggregate endpoint for dashboard"
```

---

## Phase 2: Frontend - Dashboard UI

### Task 4: Install ECharts and remove react-router

**Files:**
- Modify: `packages/web/package.json`

**Step 1: Update dependencies**

```bash
cd packages/web
pnpm remove react-router-dom
pnpm add echarts echarts-for-react
```

**Step 2: Commit**

```bash
git add -A && git commit -m "chore(web): add echarts, remove react-router"
```

---

### Task 5: Create Dashboard component

**Files:**
- Create: `packages/web/src/Dashboard.tsx`
- Modify: `packages/web/src/App.tsx`
- Modify: `packages/web/src/main.tsx`

**Step 1: Create Dashboard**

`packages/web/src/Dashboard.tsx`:
```tsx
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
```

**Step 2: Update App.tsx**

`packages/web/src/App.tsx`:
```tsx
import { Dashboard } from "./Dashboard";

export function App() {
  return <Dashboard />;
}
```

**Step 3: Update main.tsx**

`packages/web/src/main.tsx`:
```tsx
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import "./index.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>
);
```

**Step 4: Commit**

```bash
git add -A && git commit -m "feat(web): create Dashboard component"
```

---

### Task 6: Create SessionFilter component

**Files:**
- Create: `packages/web/src/components/SessionFilter.tsx`

**Step 1: Create component**

`packages/web/src/components/SessionFilter.tsx`:
```tsx
import { useState, useRef, useEffect } from "react";
import type { Session } from "@ccray/shared";

interface Props {
  sessions: Session[];
  selectedIds: string[];
  onChange: (ids: string[]) => void;
}

export function SessionFilter({ sessions, selectedIds, onChange }: Props) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  // Close on outside click
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

  const toggle = (id: string) => {
    if (selectedIds.includes(id)) {
      onChange(selectedIds.filter((s) => s !== id));
    } else {
      onChange([...selectedIds, id]);
    }
  };

  const selectAll = () => onChange(sessions.map((s) => s.sessionId));
  const clearAll = () => onChange([]);

  return (
    <div className="session-filter" ref={ref}>
      <button className="filter-button" onClick={() => setOpen(!open)}>
        Sessions ({selectedIds.length}/{sessions.length}) ▼
      </button>

      {open && (
        <div className="filter-dropdown">
          <div className="filter-actions">
            <button onClick={selectAll}>Select All</button>
            <button onClick={clearAll}>Clear</button>
          </div>
          <div className="filter-list">
            {sessions.map((s) => (
              <label key={s.sessionId} className="filter-item">
                <input
                  type="checkbox"
                  checked={selectedIds.includes(s.sessionId)}
                  onChange={() => toggle(s.sessionId)}
                />
                <span className="filter-label">
                  <span className="project">{getProjectName(s.projectPath)}</span>
                  <span className="time">{formatRelativeTime(s.startTs)}</span>
                  <span className="message">{truncate(s.firstMessage, 30)}</span>
                </span>
              </label>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function getProjectName(path: string): string {
  const parts = path.split("/");
  const last = parts[parts.length - 1];
  // Remove leading dash prefix from encoded paths
  return last.replace(/^-+/, "").split("-").pop() ?? last;
}

function formatRelativeTime(ts: number): string {
  const diff = Date.now() - ts;
  const minutes = Math.floor(diff / 60000);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);

  if (days > 0) return `${days}d ago`;
  if (hours > 0) return `${hours}h ago`;
  if (minutes > 0) return `${minutes}m ago`;
  return "just now";
}

function truncate(s: string | null, len: number): string {
  if (!s) return "";
  if (s.length <= len) return s;
  return s.slice(0, len) + "...";
}
```

**Step 2: Commit**

```bash
git add -A && git commit -m "feat(web): create SessionFilter component"
```

---

### Task 7: Create TokensChart component

**Files:**
- Create: `packages/web/src/components/TokensChart.tsx`

**Step 1: Create component**

`packages/web/src/components/TokensChart.tsx`:
```tsx
import ReactECharts from "echarts-for-react";

interface DataPoint {
  ts: number;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
}

interface Props {
  data: DataPoint[];
}

export function TokensChart({ data }: Props) {
  if (data.length === 0) {
    return <div className="empty">No token data</div>;
  }

  const option = {
    tooltip: {
      trigger: "axis",
      formatter: (params: any) => {
        const date = new Date(params[0].axisValue).toLocaleString();
        let html = `<strong>${date}</strong><br/>`;
        for (const p of params) {
          html += `${p.marker} ${p.seriesName}: ${p.value.toLocaleString()}<br/>`;
        }
        return html;
      },
    },
    legend: {
      data: ["Input", "Output", "Cache Read"],
      textStyle: { color: "#8b949e" },
    },
    grid: {
      left: "3%",
      right: "4%",
      bottom: "3%",
      containLabel: true,
    },
    xAxis: {
      type: "time",
      axisLine: { lineStyle: { color: "#30363d" } },
      axisLabel: { color: "#8b949e" },
    },
    yAxis: {
      type: "value",
      axisLine: { lineStyle: { color: "#30363d" } },
      axisLabel: { color: "#8b949e", formatter: (v: number) => formatNumber(v) },
      splitLine: { lineStyle: { color: "#21262d" } },
    },
    series: [
      {
        name: "Input",
        type: "line",
        data: data.map((d) => [d.ts, d.inputTokens]),
        itemStyle: { color: "#58a6ff" },
        smooth: true,
      },
      {
        name: "Output",
        type: "line",
        data: data.map((d) => [d.ts, d.outputTokens]),
        itemStyle: { color: "#3fb950" },
        smooth: true,
      },
      {
        name: "Cache Read",
        type: "line",
        data: data.map((d) => [d.ts, d.cacheReadTokens]),
        itemStyle: { color: "#d29922" },
        lineStyle: { type: "dashed" },
        smooth: true,
      },
    ],
    backgroundColor: "transparent",
  };

  return <ReactECharts option={option} style={{ height: 300 }} />;
}

function formatNumber(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return n.toString();
}
```

**Step 2: Commit**

```bash
git add -A && git commit -m "feat(web): create TokensChart component"
```

---

### Task 8: Create TimeBreakdown component

**Files:**
- Create: `packages/web/src/components/TimeBreakdown.tsx`

**Step 1: Create component**

`packages/web/src/components/TimeBreakdown.tsx`:
```tsx
import ReactECharts from "echarts-for-react";

interface BreakdownItem {
  name: string;
  type: "llm" | "builtin" | "mcp";
  calls: number;
  totalMs: number;
  avgMs: number;
  p95Ms: number;
  errors: number;
}

interface Props {
  data: BreakdownItem[];
}

const COLORS = {
  llm: "#2dd4bf",
  builtin: "#60a5fa",
  mcp: "#c084fc",
};

export function TimeBreakdown({ data }: Props) {
  if (data.length === 0) {
    return <div className="empty">No data</div>;
  }

  // Take top 10 for chart
  const chartData = data.slice(0, 10);

  const option = {
    tooltip: {
      trigger: "axis",
      axisPointer: { type: "shadow" },
      formatter: (params: any) => {
        const item = params[0];
        const d = chartData[item.dataIndex];
        return `<strong>${d.name}</strong><br/>
          Calls: ${d.calls}<br/>
          Total: ${formatMs(d.totalMs)}<br/>
          Avg: ${formatMs(d.avgMs)}<br/>
          Errors: ${d.errors}`;
      },
    },
    grid: {
      left: "3%",
      right: "15%",
      bottom: "3%",
      containLabel: true,
    },
    xAxis: {
      type: "value",
      axisLine: { lineStyle: { color: "#30363d" } },
      axisLabel: { color: "#8b949e", formatter: (v: number) => formatMs(v) },
      splitLine: { lineStyle: { color: "#21262d" } },
    },
    yAxis: {
      type: "category",
      data: chartData.map((d) => d.name).reverse(),
      axisLine: { lineStyle: { color: "#30363d" } },
      axisLabel: { color: "#c9d1d9", width: 150, overflow: "truncate" },
    },
    series: [
      {
        type: "bar",
        data: chartData
          .map((d) => ({
            value: d.totalMs,
            itemStyle: { color: COLORS[d.type] },
          }))
          .reverse(),
        label: {
          show: true,
          position: "right",
          formatter: (params: any) => {
            const d = chartData[chartData.length - 1 - params.dataIndex];
            return `${d.calls} calls`;
          },
          color: "#8b949e",
        },
      },
    ],
    backgroundColor: "transparent",
  };

  return (
    <div className="time-breakdown">
      <ReactECharts option={option} style={{ height: Math.max(200, chartData.length * 35) }} />

      <table className="breakdown-table">
        <thead>
          <tr>
            <th>Name</th>
            <th>Type</th>
            <th>Calls</th>
            <th>Total</th>
            <th>Avg</th>
            <th>P95</th>
            <th>Errors</th>
          </tr>
        </thead>
        <tbody>
          {data.map((d) => (
            <tr key={d.name}>
              <td className="name">{d.name}</td>
              <td>
                <span className={`badge badge-${d.type}`}>{d.type}</span>
              </td>
              <td>{d.calls}</td>
              <td>{formatMs(d.totalMs)}</td>
              <td>{formatMs(d.avgMs)}</td>
              <td>{formatMs(d.p95Ms)}</td>
              <td className={d.errors > 0 ? "has-errors" : ""}>{d.errors}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function formatMs(ms: number): string {
  if (ms < 1000) return `${ms.toFixed(0)}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  return `${(ms / 60000).toFixed(1)}m`;
}
```

**Step 2: Commit**

```bash
git add -A && git commit -m "feat(web): create TimeBreakdown component"
```

---

### Task 9: Update CSS for dashboard

**Files:**
- Modify: `packages/web/src/index.css`

**Step 1: Replace CSS**

Replace entire content of `packages/web/src/index.css`:
```css
:root {
  --bg-primary: #0d1117;
  --bg-secondary: #161b22;
  --bg-tertiary: #21262d;
  --text-primary: #c9d1d9;
  --text-secondary: #8b949e;
  --border: #30363d;
  --accent: #58a6ff;
  --success: #3fb950;
  --error: #f85149;
  --warning: #d29922;
}

* {
  box-sizing: border-box;
  margin: 0;
  padding: 0;
}

body {
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
  background: var(--bg-primary);
  color: var(--text-primary);
  line-height: 1.5;
}

/* Dashboard Layout */
.dashboard {
  min-height: 100vh;
}

.dashboard-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 1rem 2rem;
  background: var(--bg-secondary);
  border-bottom: 1px solid var(--border);
}

.header-left h1 {
  font-size: 1.5rem;
  font-weight: 600;
}

.header-right {
  display: flex;
  align-items: center;
  gap: 2rem;
}

.totals {
  display: flex;
  gap: 1.5rem;
}

.total-item {
  color: var(--text-secondary);
}

.total-item strong {
  color: var(--text-primary);
  margin-right: 0.25rem;
}

.dashboard-main {
  padding: 2rem;
  display: flex;
  flex-direction: column;
  gap: 2rem;
}

/* Panels */
.panel {
  background: var(--bg-secondary);
  border: 1px solid var(--border);
  border-radius: 8px;
  padding: 1.5rem;
}

.panel h2 {
  font-size: 1rem;
  font-weight: 500;
  color: var(--text-secondary);
  margin-bottom: 1rem;
}

/* Session Filter */
.session-filter {
  position: relative;
}

.filter-button {
  background: var(--bg-tertiary);
  border: 1px solid var(--border);
  color: var(--text-primary);
  padding: 0.5rem 1rem;
  border-radius: 6px;
  cursor: pointer;
  font-size: 0.875rem;
}

.filter-button:hover {
  border-color: var(--accent);
}

.filter-dropdown {
  position: absolute;
  top: 100%;
  right: 0;
  margin-top: 0.5rem;
  background: var(--bg-secondary);
  border: 1px solid var(--border);
  border-radius: 8px;
  width: 400px;
  max-height: 400px;
  overflow: hidden;
  z-index: 100;
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.4);
}

.filter-actions {
  display: flex;
  gap: 0.5rem;
  padding: 0.75rem;
  border-bottom: 1px solid var(--border);
}

.filter-actions button {
  background: transparent;
  border: none;
  color: var(--accent);
  cursor: pointer;
  font-size: 0.75rem;
}

.filter-list {
  max-height: 320px;
  overflow-y: auto;
}

.filter-item {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  padding: 0.75rem;
  cursor: pointer;
  border-bottom: 1px solid var(--border);
}

.filter-item:hover {
  background: var(--bg-tertiary);
}

.filter-item input {
  flex-shrink: 0;
}

.filter-label {
  display: flex;
  flex-direction: column;
  gap: 0.125rem;
  overflow: hidden;
}

.filter-label .project {
  font-weight: 500;
  color: var(--text-primary);
}

.filter-label .time {
  font-size: 0.75rem;
  color: var(--text-secondary);
}

.filter-label .message {
  font-size: 0.75rem;
  color: var(--text-secondary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

/* Table */
.breakdown-table {
  width: 100%;
  border-collapse: collapse;
  margin-top: 1.5rem;
  font-size: 0.875rem;
}

.breakdown-table th,
.breakdown-table td {
  padding: 0.5rem 0.75rem;
  text-align: left;
  border-bottom: 1px solid var(--border);
}

.breakdown-table th {
  color: var(--text-secondary);
  font-weight: 500;
}

.breakdown-table .name {
  font-family: monospace;
}

.badge {
  display: inline-block;
  padding: 0.125rem 0.5rem;
  border-radius: 9999px;
  font-size: 0.75rem;
  font-weight: 500;
}

.badge-llm {
  background: rgba(45, 212, 191, 0.2);
  color: #2dd4bf;
}

.badge-builtin {
  background: rgba(96, 165, 250, 0.2);
  color: #60a5fa;
}

.badge-mcp {
  background: rgba(192, 132, 252, 0.2);
  color: #c084fc;
}

.has-errors {
  color: var(--error);
}

/* Utils */
.loading, .empty {
  padding: 2rem;
  text-align: center;
  color: var(--text-secondary);
}
```

**Step 2: Commit**

```bash
git add -A && git commit -m "feat(web): update CSS for dashboard layout"
```

---

### Task 10: Clean up old files and build

**Files:**
- Delete: `packages/web/src/pages/SessionExplorer.tsx`
- Delete: `packages/web/src/pages/SessionView.tsx`
- Delete: `packages/web/src/components/SessionTable.tsx`
- Delete: `packages/web/src/components/ToolProfiler.tsx`

**Step 1: Remove old files**

```bash
rm packages/web/src/pages/SessionExplorer.tsx
rm packages/web/src/pages/SessionView.tsx
rm packages/web/src/components/SessionTable.tsx
rm packages/web/src/components/ToolProfiler.tsx
rmdir packages/web/src/pages
```

**Step 2: Build and test**

```bash
pnpm build
./dist/ccray open ~/.claude/projects/-Users-arthurcnops-Personal-ccray --no-browser
# Open http://127.0.0.1:3333 in browser
```

**Step 3: Commit**

```bash
git add -A && git commit -m "chore(web): remove old multi-page components"
```

---

## Summary

10 tasks across 2 phases:
1. **Phase 1** - Backend: first_message field, ingestion update, aggregate API
2. **Phase 2** - Frontend: ECharts setup, Dashboard, SessionFilter, TokensChart, TimeBreakdown, CSS, cleanup

After completion: single-page dashboard with session filtering, tokens timeline, and time breakdown visualization.
