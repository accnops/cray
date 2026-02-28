# ccray Dashboard Redesign

**Date:** 2026-02-28
**Status:** Approved

## Overview

Redesign the ccray web UI from multi-page navigation to a single-page Grafana-style dashboard. All data shown across all sessions by default, with filters to narrow down.

## Layout

```
┌─────────────────────────────────────────────────────────────────┐
│ ccray                          [Session Filter ▼] [5 sessions]  │
│                                 Total: $142.50 | 2.3M tokens    │
├─────────────────────────────────────────────────────────────────┤
│  ┌─────────────────────────────────────────────────────────┐   │
│  │ Tokens Over Time                                        │   │
│  │ [Line chart - input/output/cache over time]             │   │
│  └─────────────────────────────────────────────────────────┘   │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │ Time Breakdown                                          │   │
│  │ [Horizontal bar chart - LLM + tools by total time]      │   │
│  │ [Sortable table with details]                           │   │
│  └─────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────┘
```

- **Header**: Logo, session filter dropdown, aggregate stats (cost, tokens)
- **Panel 1**: Tokens over time (full-width line chart)
- **Panel 2**: Time breakdown (bar chart + table, full-width)

## Session Filter

Multi-select dropdown with session identifiers:

```
┌─────────────────────────────────────────────────┐
│ Session Filter                              ▼   │
├─────────────────────────────────────────────────┤
│ ☑ ccray • 2h ago • "Check out claude-code..."   │
│ ☑ ccray • 5h ago • "I don't like the UI..."     │
│ ☐ myproject • 1d ago • "Fix the login bug"      │
├─────────────────────────────────────────────────┤
│ Select All | Clear                              │
└─────────────────────────────────────────────────┘
```

- **Format**: `{project} • {relative time} • "{first message truncated}"`
- Checkboxes for multi-select
- Select All / Clear actions
- Sorted by recency (newest first)
- First message truncated to ~30 chars

## Panel 1: Tokens Over Time

Line chart showing token consumption over time.

- **X-axis**: Time (auto-scales: hours/days/weeks)
- **Y-axis**: Token count
- **Lines**:
  - Input tokens (blue)
  - Output tokens (green)
  - Cache read tokens (orange, dashed)
- **Interaction**: Hover tooltip with exact values
- **Aggregation**: Points grouped by interval (5min/1hr/1day depending on range)

## Panel 2: Time Breakdown

### Bar Chart

Horizontal bar chart showing where time is spent:

```
LLM (claude-opus-4-5) ████████████████████████████████  89 calls, 4m 32s
Read                  ████████████                      142 calls, 12.4s
Bash                  ██████████                        38 calls, 45.2s
Edit                  ██████                            24 calls, 8.1s
mcp::playwright       ██                                8 calls, 22.3s
```

- Includes LLM calls as a row (not just tools)
- Sorted by total time descending
- Color-coded: LLM (teal), builtin (blue), MCP (purple)
- User input wait time excluded

### Table

Sortable table below the bar chart:

| Name | Calls | Total Time | Avg | P95 | Errors |
|------|-------|------------|-----|-----|--------|
| LLM (claude-opus-4-5) | 89 | 4m 32s | 3.1s | 8.2s | 0 |
| Read | 142 | 12.4s | 87ms | 245ms | 0 |
| Bash | 38 | 45.2s | 1.19s | 3.2s | 2 (5%) |

- Clickable headers to sort
- Errors highlighted red when > 0
- Default sort: Total Time descending

## Data Requirements

### New API Endpoint

`GET /api/aggregate` - Returns aggregated data across selected sessions:

```json
{
  "sessions": ["id1", "id2"],
  "totals": {
    "cost": 142.50,
    "inputTokens": 1200000,
    "outputTokens": 800000,
    "cacheReadTokens": 300000
  },
  "tokensOverTime": [
    { "ts": 1234567890, "input": 1000, "output": 500, "cacheRead": 200 }
  ],
  "timeBreakdown": [
    { "name": "LLM", "calls": 89, "totalMs": 272000, "avgMs": 3100, "p95Ms": 8200, "errors": 0 },
    { "name": "Read", "calls": 142, "totalMs": 12400, "avgMs": 87, "p95Ms": 245, "errors": 0 }
  ]
}
```

### Session Metadata

Sessions need additional field for first user message (for filter labels). Either:
- Extract during ingestion and store in DB
- Fetch on-demand from first event in session

## Tech Stack

- Remove react-router-dom (no longer needed)
- Add charting library: **Apache ECharts** (already in design doc) or lightweight alternative
- Keep existing: React, TanStack Table, Hono API

## Migration

- Delete: `SessionExplorer.tsx`, `SessionView.tsx`, routing in `App.tsx`
- Create: `Dashboard.tsx` with filter state and panels
- Create: `TokensChart.tsx`, `TimeBreakdown.tsx` components
- Update: API to support aggregation queries
