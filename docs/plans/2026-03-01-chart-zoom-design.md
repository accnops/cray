# Chart Zoom Feature Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add drag-to-select zoom on TokensChart that updates all dashboard stats via server re-fetch.

**Architecture:** Dashboard holds `timeRange` state, passes to API. Server filters spans by time range, re-buckets tokens, re-aggregates timeBreakdown. Double-click resets zoom.

**Tech Stack:** React, ECharts (dataZoom brush), Hono API, SQLite

---

## Task 1: Add Time Range Params to Repository

**Files:**
- Modify: `packages/db/src/repository.ts:398-573`

**Step 1: Update getAggregate signature**

Add optional `startTime` and `endTime` parameters to `getAggregate`:

```typescript
getAggregate(sessionIds: string[], startTime?: number, endTime?: number): AggregateData {
```

**Step 2: Add time filtering to spans queries**

After the placeholders line (~403), add time filter logic:

```typescript
const timeFilter = startTime !== undefined && endTime !== undefined
  ? ` AND start_ts >= ${startTime} AND start_ts <= ${endTime}`
  : "";
```

Apply to:
- `tokensStmt` query (line ~420): add `${timeFilter}` after session filter
- `llmIntervalsStmt` query (line ~443): add `${timeFilter}` after span_type filter
- `toolIntervalsStmt` query (line ~464): add `${timeFilter}` in WHERE clause

**Step 3: Recalculate totals from filtered spans**

When time filter is active, compute totals from spans instead of sessions table:

```typescript
// After tokensRows query
let totals: { cost: number; inputTokens: number; outputTokens: number; cacheReadTokens: number; durationMs: number };

if (startTime !== undefined && endTime !== undefined) {
  // Calculate from filtered spans
  const inputTokens = tokensRows.reduce((sum, r) => sum + r.input_tokens, 0);
  const outputTokens = tokensRows.reduce((sum, r) => sum + r.output_tokens, 0);
  const cacheReadTokens = tokensRows.reduce((sum, r) => sum + r.cache_read_tokens, 0);
  totals = { cost: 0, inputTokens, outputTokens, cacheReadTokens, durationMs: 0 };
} else {
  // Use session totals (existing logic)
  totals = {
    cost: totalsRow.cost ?? 0,
    inputTokens: totalsRow.input_tokens ?? 0,
    outputTokens: totalsRow.output_tokens ?? 0,
    cacheReadTokens: totalsRow.cache_read_tokens ?? 0,
    durationMs: 0,
  };
}
```

**Step 4: Run existing tests**

Run: `cd /Users/arthurcnops/Personal/ccray && bun test`
Expected: All tests pass (if any exist)

**Step 5: Commit**

```bash
git add packages/db/src/repository.ts
git commit -m "feat(db): add time range filtering to getAggregate"
```

---

## Task 2: Add Time Range Params to API Route

**Files:**
- Modify: `packages/server/src/routes.ts:44-53`

**Step 1: Parse startTime and endTime query params**

Update the `/api/aggregate` handler:

```typescript
app.get("/api/aggregate", (c) => {
  const sessionIdsParam = c.req.query("sessions");
  const sessionIds = sessionIdsParam ? sessionIdsParam.split(",") : [];

  const startTimeParam = c.req.query("startTime");
  const endTimeParam = c.req.query("endTime");
  const startTime = startTimeParam ? parseInt(startTimeParam, 10) : undefined;
  const endTime = endTimeParam ? parseInt(endTimeParam, 10) : undefined;

  // If no sessions specified, use all
  const ids = sessionIds.length > 0 ? sessionIds : repo.listSessions().map(s => s.sessionId);

  const data = repo.getAggregate(ids, startTime, endTime);
  return c.json(data);
});
```

**Step 2: Commit**

```bash
git add packages/server/src/routes.ts
git commit -m "feat(api): accept startTime/endTime params in /api/aggregate"
```

---

## Task 3: Add Zoom State to Dashboard

**Files:**
- Modify: `packages/web/src/Dashboard.tsx`

**Step 1: Add timeRange state**

After `selectedIds` state (~line 37):

```typescript
const [timeRange, setTimeRange] = useState<{ start: number; end: number } | null>(null);
```

**Step 2: Update queryString to include time params**

Update the `queryString` useMemo:

```typescript
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
```

**Step 3: Reset timeRange when sessions change**

Add effect after the session selection effect:

```typescript
// Reset zoom when sessions change
useEffect(() => {
  setTimeRange(null);
}, [selectedIds]);
```

**Step 4: Pass onZoomChange to TokensChart**

Update TokensChart usage:

```typescript
<TokensChart
  data={aggregate.tokensOverTime}
  onZoomChange={setTimeRange}
/>
```

**Step 5: Add date range to header**

Update the header totals section to show date range:

```typescript
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
```

**Step 6: Add formatDateRange helper**

Add at bottom of file:

```typescript
function formatDateRange(start: number, end: number): string {
  const startDate = new Date(start);
  const endDate = new Date(end);
  const sameDay = startDate.toDateString() === endDate.toDateString();

  if (sameDay) {
    return `${startDate.toLocaleDateString()} ${startDate.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} - ${endDate.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
  }
  return `${startDate.toLocaleDateString()} - ${endDate.toLocaleDateString()}`;
}
```

**Step 7: Commit**

```bash
git add packages/web/src/Dashboard.tsx
git commit -m "feat(web): add zoom state management to Dashboard"
```

---

## Task 4: Add Brush Zoom to TokensChart

**Files:**
- Modify: `packages/web/src/components/TokensChart.tsx`

**Step 1: Update Props interface**

```typescript
interface Props {
  data: DataPoint[];
  onZoomChange?: (range: { start: number; end: number } | null) => void;
}
```

**Step 2: Update component signature**

```typescript
export function TokensChart({ data, onZoomChange }: Props) {
```

**Step 3: Add useRef for chart instance**

Add import and ref:

```typescript
import ReactECharts from "echarts-for-react";
import { useRef, useCallback } from "react";

// Inside component:
const chartRef = useRef<ReactECharts>(null);
```

**Step 4: Add brush dataZoom to option**

Add `toolbox` and `brush` config after `series`:

```typescript
toolbox: {
  feature: {
    brush: {
      type: ["lineX", "clear"],
      title: { lineX: "Zoom", clear: "Reset" },
    },
  },
  right: 20,
  top: 0,
},
brush: {
  toolbox: ["lineX", "clear"],
  xAxisIndex: 0,
  brushStyle: {
    borderWidth: 1,
    color: "rgba(88, 166, 255, 0.2)",
    borderColor: "#58a6ff",
  },
},
```

**Step 5: Add event handlers**

Add after the option definition:

```typescript
const onBrushEnd = useCallback((params: any) => {
  if (!onZoomChange) return;

  const areas = params.areas;
  if (!areas || areas.length === 0) return;

  const area = areas[0];
  if (area.coordRange && area.coordRange.length === 2) {
    const [start, end] = area.coordRange;
    // Ignore tiny selections (< 1 second)
    if (end - start < 1000) return;
    onZoomChange({ start, end });
  }
}, [onZoomChange]);

const onEvents = {
  brushEnd: onBrushEnd,
  dblclick: () => onZoomChange?.(null),
};
```

**Step 6: Update ReactECharts component**

```typescript
return (
  <ReactECharts
    ref={chartRef}
    option={option}
    style={{ height: 300 }}
    onEvents={onEvents}
  />
);
```

**Step 7: Commit**

```bash
git add packages/web/src/components/TokensChart.tsx
git commit -m "feat(chart): add brush zoom selection with double-click reset"
```

---

## Task 5: Add CSS for Date Range Display

**Files:**
- Modify: `packages/web/src/index.css`

**Step 1: Add date-range styling**

Add to the existing styles:

```css
.date-range {
  color: #58a6ff;
  font-size: 0.9em;
}
```

**Step 2: Commit**

```bash
git add packages/web/src/index.css
git commit -m "style: add date range display styling"
```

---

## Task 6: Manual Testing

**Step 1: Start dev server**

Run: `cd /Users/arthurcnops/Personal/ccray && bun run dev`

**Step 2: Test zoom selection**

1. Open dashboard in browser
2. Click brush tool in chart toolbar (or use default)
3. Drag to select a time range
4. Verify: header shows date range, token count updates, TimeBreakdown updates

**Step 3: Test zoom reset**

1. Double-click on chart
2. Verify: returns to full range, date range disappears from header

**Step 4: Test edge cases**

1. Select range with no data → verify handling
2. Rapid selections → verify no race conditions
3. Change session selection while zoomed → verify zoom resets

**Step 5: Final commit if any fixes needed**

```bash
git add -A
git commit -m "fix: address issues found in manual testing"
```
