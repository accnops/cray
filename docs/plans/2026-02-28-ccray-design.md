# ccray Design Document

**Date:** 2026-02-28
**Status:** Approved

## Overview

ccray is a CLI-first local profiler with a browser-based debugger UI for Claude Code sessions.

**Core value:** Parse JSONL transcripts → normalize into a trace model → visualize performance, tool usage, token costs, and subagent behavior.

**Primary interface:**
- CLI commands (`ccray open`, `ccray stats`, etc.)
- Local web UI (binds to 127.0.0.1, no external network calls)

**Key principles:**
- Local-only by default (safe for private codebases)
- Easy for Claude Code itself to install and run
- Subagent-aware (treats subagents as first-class agents, not flattened)

**Target users:** Claude Code users who want visibility into session performance, tool usage patterns, and costs.

---

## CLI Interface

### Distribution

- **Primary:** Standalone binary via Bun compile (no runtime needed)
- **Secondary:** `npm install -g ccray` for those who prefer it

### Installation

```bash
# Standalone binary
curl -fsSL https://ccray.dev/install.sh | sh

# Or via npm
npm install -g ccray
```

### Commands

```bash
# Auto-discover sessions, launch explorer UI
ccray open

# Parse specific session and launch UI
ccray open ~/.claude/projects/myproj/<session-id>

# Live mode - stream updates as session runs
ccray open ~/.claude/projects/myproj/<session-id> --follow

# Parse recent sessions under a project
ccray open ~/.claude/projects/myproj --recent 20

# Terminal summary (no UI)
ccray stats ~/.claude/projects/myproj/<session-id>

# Export normalized data
ccray export ~/.claude/projects/myproj/<session-id> --format parquet

# Build cache without opening UI
ccray ingest ~/.claude/projects/myproj

# Start server against existing cache
ccray serve ~/.cache/ccray
```

### Flags

- `--no-browser` - don't auto-open browser
- `--port <n>` - custom port
- `--json` - machine-readable output (for automation)
- `--redact` - strip sensitive data from exports
- `--reindex` - force re-parse even if cached

### Behavior

`ccray open` auto-detects whether path is a session or project root, discovers all JSONL files (main + subagents), parses, caches to SQLite, starts local server, opens browser.

With no arguments, scans `~/.claude/projects/` and opens the session explorer.

---

## Data Model

SQLite database with these core tables:

### sessions

| Column | Type | Description |
|--------|------|-------------|
| session_id | TEXT PK | Unique session identifier |
| project_path | TEXT | Project directory path |
| start_ts | INTEGER | Start timestamp (ms) |
| end_ts | INTEGER | End timestamp (ms) |
| duration_ms | INTEGER | Total duration |
| total_input_tokens | INTEGER | Sum of input tokens |
| total_output_tokens | INTEGER | Sum of output tokens |
| total_cache_read_tokens | INTEGER | Tokens read from cache |
| total_cache_write_tokens | INTEGER | Tokens written to cache |
| estimated_cost_usd | REAL | Estimated cost in USD |

### agents

| Column | Type | Description |
|--------|------|-------------|
| agent_id | TEXT PK | Unique agent identifier |
| session_id | TEXT FK | Parent session |
| parent_agent_id | TEXT | Parent agent (null for main) |
| kind | TEXT | 'main' or 'subagent' |
| transcript_path | TEXT | Path to JSONL file |
| start_ts | INTEGER | Start timestamp |
| end_ts | INTEGER | End timestamp |
| link_confidence | REAL | Confidence in parent link |
| total_input_tokens | INTEGER | Agent's input tokens |
| total_output_tokens | INTEGER | Agent's output tokens |
| estimated_cost_usd | REAL | Agent's estimated cost |

### spans

| Column | Type | Description |
|--------|------|-------------|
| span_id | TEXT PK | Unique span identifier |
| session_id | TEXT FK | Parent session |
| agent_id | TEXT FK | Parent agent |
| parent_span_id | TEXT | Parent span (nullable) |
| span_type | TEXT | Type of span (see below) |
| start_ts | INTEGER | Start timestamp |
| end_ts | INTEGER | End timestamp |
| duration_ms | INTEGER | Duration |
| status | TEXT | success/error/unknown |
| input_tokens | INTEGER | Tokens in (for LLM spans) |
| output_tokens | INTEGER | Tokens out (for LLM spans) |
| cache_read_tokens | INTEGER | Cache read tokens |
| cache_write_tokens | INTEGER | Cache write tokens |
| model | TEXT | Model used (for LLM spans) |

### Span Types

- `agent_llm_active` - LLM thinking/generating
- `tool_call_builtin` - Built-in tool execution
- `tool_call_mcp` - MCP tool execution
- `hook_pre` - Pre-tool hook
- `hook_post` - Post-tool hook
- `permission_wait` - Waiting for user permission
- `subagent_spawn` - Spawning a subagent
- `compaction` - Context compaction
- `unknown_gap` - Unexplained time gap

### tool_calls

| Column | Type | Description |
|--------|------|-------------|
| tool_call_id | TEXT PK | Unique identifier |
| span_id | TEXT FK | Parent span |
| session_id | TEXT FK | Parent session |
| agent_id | TEXT FK | Parent agent |
| tool_family | TEXT | 'builtin' or 'mcp' |
| tool_name | TEXT | Tool name |
| mcp_server | TEXT | MCP server name (nullable) |
| status | TEXT | success/error |
| error_type | TEXT | Error type (nullable) |
| input_bytes | INTEGER | Input payload size |
| output_bytes | INTEGER | Output payload size |

### events

| Column | Type | Description |
|--------|------|-------------|
| event_id | TEXT PK | Unique identifier |
| session_id | TEXT FK | Parent session |
| agent_id | TEXT FK | Parent agent |
| ts | INTEGER | Timestamp |
| raw_type | TEXT | Original event type |
| norm_type | TEXT | Normalized event type |
| raw_line_no | INTEGER | Line number in JSONL |
| raw_json | TEXT | Original JSON |

---

## UI Screens

### Screen 1: Session Explorer

List of sessions when viewing a project root (or all projects with no args).

**Columns:**
- Start time, duration, agent count, tool calls, error count
- Total tokens, estimated cost, cost/minute

**Filters:**
- Has errors, uses MCP, duration > N, date range, cost > N

### Screen 2: Trace Timeline

PixiJS-rendered zoomable timeline.

- **X-axis:** Time
- **Y-axis:** Swimlanes for main agent + subagents
- **Span colors:** LLM (blue), builtin tools (green), MCP tools (purple), hooks (orange), waiting (gray)
- **Interactions:** Zoom, pan, click span → details panel, filter by tool/agent/error
- **Live mode:** Auto-follow head, "LIVE" badge when `--follow`

### Screen 3: Tool Profiler

Aggregated stats table.

**Grouping:** By tool, by tool family, by MCP server, by agent

**Metrics:**
- Calls, total time, avg/p50/p95/max, error rate
- Input/output bytes, % wall-time
- Tokens consumed (for LLM-adjacent tools)

### Screen 4: Execution Tree / Icicle

Flamegraph-style view.

- Hierarchy: Session → Agent → Spans
- Width = duration (or token count toggle)
- Modes: Inclusive time, exclusive time, count

### Global: Details Side Panel

When selecting any span:
- Normalized summary, timestamps, duration
- Tool payload sizes, status/error
- Token counts, model used, cost
- Raw JSONL lines with syntax highlighting

---

## Tech Stack

### Runtime & CLI

- **Runtime:** Bun (compile to standalone binary)
- **CLI framework:** Commander
- **API server:** Elysia or Hono (Bun-native)

### Database

- **SQLite:** `bun:sqlite` (native, no external deps)

### Frontend

- **Framework:** React + Vite + TypeScript
- **Timeline:** PixiJS (WebGL) + d3-scale for axes
- **Charts:** Apache ECharts for summary charts
- **Tables:** TanStack Table (virtualized)
- **Flamegraph:** Speedscope-compatible viewer or custom PixiJS

### Shared

- **Schema validation:** Zod
- **Date/time:** Native Date or Temporal polyfill

### Repo Structure

```
ccray/
  packages/
    cli/        # Commands, binary entrypoint
    parser/     # JSONL parsing + normalization
    db/         # SQLite schema + queries
    server/     # Local API (Elysia/Hono)
    web/        # React UI
    shared/     # Types, schemas, constants
```

pnpm monorepo with shared TypeScript config.

---

## MVP Scope

### v0.1 (Must-Have)

- Auto-discovery: `ccray open` scans `~/.claude/projects/` and lists all sessions
- Session explorer UI from day one
- Parse session (main + subagents)
- Normalize tool calls (builtin + MCP) and LLM spans
- Extract token usage from JSONL
- SQLite cache with indexed queries
- `ccray open` → local server → browser UI
- `ccray open <path>` for direct access
- `ccray stats` → terminal summary with token costs
- UI: Session explorer, trace timeline, tool profiler, details panel
- Standalone binary for macOS (arm64 + x64)

### v0.2 (Soon After)

- Linux + Windows binaries
- Icicle/flamegraph view
- `ccray export` to JSON/Parquet
- Live mode (`--follow`)

### Later

- Session comparison / diff
- Critical path analysis
- Redaction options for exports
- Optional TUI mode

---

## Security & Privacy

### Local-First Defaults

- Web server binds to `127.0.0.1` only
- No external network calls for core features
- No telemetry by default
- Cache stored in `~/.cache/ccray/`

### Data Handling

- Raw JSONL may contain prompts, code, paths, secrets
- `ccray cache clear` to wipe local cache
- `ccray export --redact` strips sensitive content (later feature)
- Clear warnings when exporting raw JSON

### Open Source

- MIT or Apache 2.0 license
- Published on GitHub
- npm + binary releases via GitHub Releases

---

## Token Cost Calculation

Based on JSONL `usage` fields:

```json
{
  "input_tokens": 10,
  "cache_creation_input_tokens": 9436,
  "cache_read_input_tokens": 15797,
  "output_tokens": 183,
  "service_tier": "standard"
}
```

Cost estimation uses Anthropic pricing with:
- Model awareness (Opus vs Sonnet vs Haiku)
- Cache read discount (10% of input cost)
- Cache write premium (25% more than input cost)

Displayed throughout UI: session list, timeline spans, tool profiler, details panel.
