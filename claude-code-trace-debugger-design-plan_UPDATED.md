# Claude Code Trace Debugger - Design Plan

## Goal

Build an installable tool that parses Claude Code JSONL transcripts (main agent + subagents), normalizes them into a trace model, and provides:

- Per-tool-call stats (latency, frequency, errors, bytes in/out)
- Session-level performance breakdown (LLM vs tools vs hooks vs waiting)
- Subagent-aware timelines and execution views
- Debuggable raw-event inspection (click-through to source JSON)

The tool should be easy to run locally from a terminal, ideally by Claude Code itself (simple CLI command, zero or low config), and safe to use on private codebases (local-only processing by default).

---

## Product Shape

### Primary interface

**CLI-first with a local web UI**.

Why this shape:
- Claude Code can easily install and run a CLI
- Parsing and indexing are better controlled from CLI commands
- Rich timeline/trace visualizations are much better in a browser than in a TUI
- Web UI supports flamegraph/icicle, zooming, filtering, and JSON side panels cleanly

### Secondary interface (optional, later)

- **TUI summary mode** for quick stats in SSH / headless environments
  - Top slow tools
  - Erroring tool calls
  - Time breakdown by category
  - Per-agent summary

This should be a later feature, not the initial focus.

---

## UX Overview

### CLI commands (proposed)

```bash
# Parse one session directory and launch UI
cc-trace open ~/.claude/projects/myproj/<session-id>

# Open UI and stream updates live as the session is still running (tail JSONL)
cc-trace open ~/.claude/projects/myproj/<session-id> --follow

# Parse all recent sessions under a project and launch UI
cc-trace open ~/.claude/projects/myproj --recent 20

# Build cache/index without opening UI
cc-trace ingest ~/.claude/projects/myproj

# Print terminal summary stats (fast path)
cc-trace stats ~/.claude/projects/myproj/<session-id>

# Export normalized trace as JSON/Parquet for analysis
cc-trace export ~/.claude/projects/myproj/<session-id> --format parquet

# Start web UI against an existing cache/index
cc-trace serve ~/.cache/cc-trace
```

### CLI behavior

`cc-trace open <path>` should:
1. Detect whether path is a single session or project root
2. Discover transcript JSONL files (main + `subagents/*.jsonl`)
3. Parse and normalize traces
4. Write cache/index locally
5. Start a local web server (or static app + local API)
6. Open the browser automatically unless `--no-browser`

If `--follow` is set, it should additionally:
- Watch transcript JSONL files for appended lines (main + subagents)
- Incrementally ingest new events into the cache/index
- Push deltas to the UI over WebSocket so charts update live without refresh

This gives a one-command experience that is easy for humans and easy for Claude Code to run.

---

## UI Design

### Main UI: browser app (local-only)

### Visualization stack (recommendation)

**Primary recommendation: PixiJS (WebGL) + a thin trace-rendering layer.**

Rationale:
- The hard visualization here is the **zoomable, multi-lane timeline** with potentially tens/hundreds of thousands of spans.
- PixiJS is widely used and well respected for high-performance 2D rendering, and it stays smooth by pushing draw work to the GPU.
- Pair PixiJS with lightweight D3 utilities (e.g., `d3-scale`) for time scales/ticks, without using D3 for DOM rendering.

How it’s used:
- Render spans, lane labels, selection overlays, and heatmaps on a single WebGL canvas.
- Render UI chrome (tables, filters, panels) in React.

**Secondary charts (optional): Apache ECharts.**
- Use ECharts for pies/bars/stacked-area in summary panels if you don’t want to build those in-house.
- It has strong performance characteristics and good defaults for dashboards.

**Flamegraph/icicle (optional): Speedscope format compatibility.**
- Export to Speedscope JSON so users can open traces in Speedscope, and/or embed a Speedscope-compatible viewer.


#### Screen 1: Session Explorer
- List of sessions (if project root selected)
- Columns:
  - start time
  - duration
  - number of agents/subagents
  - tool calls
  - error count
  - top time bucket
- Filters:
  - has errors
  - uses MCP
  - duration > N
  - date range

#### Screen 2: Trace Timeline (primary debugger view)
- X-axis = time
- Y-axis = swimlanes for main agent + subagents
- Span colors by category:
  - LLM active
  - built-in tool call
  - MCP tool call
  - hooks
  - waiting / blocked
  - compaction / system
- Interactions:
  - zoom, pan, brush select
  - click span -> details panel
  - filter by tool family / agent / error status
  - show only critical path (later)
  - live mode: toggle auto-follow head, pause/resume streaming, show “LIVE” badge when `--follow`
  - time cursor: jump to “now”, and optional auto-scroll while live

#### Screen 3: Tool Profiler
- Aggregated table of tool stats
- Grouping toggles:
  - by tool
  - by tool family
  - by MCP server + tool
  - by agent
- Metrics:
  - calls
  - total time
  - avg / p50 / p95 / max
  - error rate
  - bytes in/out
  - % wall-time attribution
  - inclusive time
- Drill-down into individual calls

#### Screen 4: Execution Tree / Icicle (flamegraph-ish)
- Hierarchy by orchestration:
  - Session -> agent/subagent -> spans
- Width = duration
- Modes:
  - inclusive duration
  - exclusive duration
  - count
- Useful for expensive subtrees and expensive subagents

#### Details Side Panel (global)
When selecting any span/event/call:
- normalized summary
- linked raw JSONL lines
- timestamps + duration
- tool payload sizes
- status/error
- link confidence (for inferred parent-child/subagent relationships)

---

## Architecture

### High-level components

1. **CLI** (entrypoint)
2. **Parser + Normalizer** (JSONL -> trace/events/spans)
3. **Local Cache / Index** (SQLite + optional Parquet exports)
4. **Local API server** (serves query endpoints)
5. **Web UI** (reads from local API)

### Data flow

```text
Claude Code session dir(s)
  -> file discovery
  -> JSONL parsing (streaming)
  -> normalization + inference
  -> cache/index (SQLite)
  -> local API
  -> browser UI
```

Live mode (`--follow`) extends this pipeline:
- file watcher tails JSONL append-only writes
- incremental parse/normalize into SQLite (append-only, idempotent)
- server publishes deltas via WebSocket/SSE
- UI applies incremental updates (no full reload) while preserving zoom/selection state


### Why not pure static files only?
A local API makes it easier to:
- filter large traces efficiently
- paginate raw events
- compute p95/p99 on demand
- support multiple sessions and comparisons
- avoid loading massive JSON into the browser

---

## Stack Recommendation

### Recommended stack (v1)

**TypeScript end-to-end**, but avoid Bun as a hard requirement in v1.

- **Runtime/CLI/API:** Node.js (LTS) + TypeScript
- **CLI framework:** `commander` or `oclif` (commander is simpler for v1)
- **Web server/API:** `Fastify` (fast, typed, good plugin ecosystem)
- **Database/cache:** SQLite (`better-sqlite3`) for local indexed queries
- **Frontend:** React + Vite + TypeScript
- **Visualization:**
  - Timeline + trace: PixiJS (WebGL) + `d3-scale` for axes/ticks
  - Summary charts: Apache ECharts (optional)
  - Tables: TanStack Table
  - Flamegraph/icicle: Speedscope export + optional embedded viewer
- **Schema validation:** `zod`
- **Date/time:** `luxon` or native `Temporal` polyfill

### Why Node over Bun (for v1)
Bun is appealing (fast startup, all-in-one), but Node wins on:
- compatibility with native sqlite libs (`better-sqlite3`)
- broader ecosystem stability
- easier install expectations on developer machines
- fewer surprises for users and for Claude Code-driven setup

### Bun path (v2 option)
If startup time becomes important, a Bun build can be added later. Keep code mostly runtime-agnostic where possible.

### Alternative stack (Python)
Python is also viable for parsing + local server (FastAPI + SQLite + React UI), but TypeScript has a stronger advantage if you want one language across CLI, parser, API, and UI.

---

## Installation and Distribution

### Install targets

#### Option A (preferred): npm package
```bash
npm install -g cc-trace-debugger
# command: cc-trace
```

Pros:
- easiest for Claude Code to install/run
- simple upgrades
- common dev workflow

#### Option B: npx ephemeral run
```bash
npx cc-trace-debugger open <path>
```

Pros:
- zero permanent install
- good for quick tests

Cons:
- slower startup
- less ideal for repeated use

#### Option C: single binary (later)
Use `pkg`/`nexe` or similar packaging (or Rust rewrite later) for environments where Node install is a barrier.

### Claude Code friendliness
To be easy for Claude Code to use, support:
- a single command (`cc-trace open <session-dir>`)
- machine-readable outputs (`--json` for summary commands)
- non-interactive mode (`--no-browser`)
- deterministic cache location (`--cache-dir`)
- local-only networking (`127.0.0.1` bind by default)

---

## Data Model (Normalized)

### Core tables/entities

#### `sessions`
- `session_id`
- `project_path`
- `start_ts`
- `end_ts`
- `duration_ms`
- `transcript_version` (nullable)
- `parse_warnings_count`

#### `agents`
- `agent_id`
- `session_id`
- `parent_agent_id` (nullable)
- `kind` (`main` | `subagent`)
- `transcript_path`
- `start_ts`
- `end_ts`
- `link_confidence`

#### `events`
Raw-ish normalized events (point-in-time)
- `event_id`
- `session_id`
- `agent_id`
- `ts`
- `raw_type`
- `norm_type`
- `raw_line_no`
- `raw_json` (JSON text)
- correlation ids (`uuid`, `parent_uuid`, etc. nullable)

#### `spans`
Timed intervals inferred from events
- `span_id`
- `session_id`
- `agent_id`
- `parent_span_id` (nullable)
- `span_type`
- `start_ts`
- `end_ts`
- `duration_ms`
- `status`
- `inferred` (bool)
- `inference_confidence`

#### `tool_calls`
- `tool_call_id`
- `span_id`
- `session_id`
- `agent_id`
- `tool_family` (`builtin` | `mcp`)
- `tool_name`
- `mcp_server` (nullable)
- `mcp_tool_name` (nullable)
- `status`
- `error_type` (nullable)
- `input_bytes` (nullable)
- `output_bytes` (nullable)

#### `links`
Causal/inferred relationships not expressible as strict parents
- `src_id`, `dst_id`
- `link_type` (`spawn`, `join`, `causal`, `heuristic`)
- `confidence`
- `reason`

---

## Span Taxonomy (for profiling)

### Raw/normalized span types
- `agent_llm_active`
- `tool_call_builtin`
- `tool_call_mcp`
- `hook_pre`
- `hook_post`
- `permission_wait`
- `subagent_spawn`
- `subagent_poll_wait`
- `compaction`
- `unknown_gap`

### Derived time buckets (UI summary)
- Thinking/LLM
- Tools (Built-in)
- Tools (MCP)
- Hooks
- Waiting
- System/Compaction
- Unknown

---

## Handling Subagents

### Discovery
Discover subagent transcripts via known layout (e.g., `subagents/agent-*.jsonl`) alongside the main transcript.

### Linking strategy (layered)
1. **Explicit IDs** (best)
   - `agentId`, `sessionId`, `uuid`, `parentUuid`
2. **Tool/event semantics**
   - subagent/task launch events and corresponding results
3. **Path + timestamp heuristics**
   - file path, creation time, event timing overlap/proximity

### Important implementation note
Subagents should be represented as first-class agents with independent timelines. Do not flatten their events into the main lane; link them instead.

---

## Time Attribution Strategy

### Problem
Parallel subagents and overlapping tool calls can make total durations exceed session wall time.

### Solution
Track both:

1. **Wall-clock attribution (partitioned)**
- sums to ~100% of session wall time
- used for pie charts and top-level percentages

2. **Inclusive activity time**
- allows overlap
- used for utilization and "who did the most work" views

### Suggested approach (v1)
- Build all spans on a shared timeline
- Sweep line over time segments
- Attribute each segment to one bucket based on precedence rules for wall-clock view
- Keep raw overlaps for inclusive metrics

Example precedence (tunable):
`permission_wait > hook > tool_call > agent_llm_active > unknown_gap`

---

## Parsing and Inference Plan

### Parser requirements
- Streaming JSONL parse (do not load entire files into memory)
- Tolerate malformed lines (record warning + continue)
- Preserve unknown fields and raw JSON
- Version-aware parsing where possible

### Normalization strategy
- Map many raw event shapes to a smaller set of `norm_type` values
- Extract timestamps, IDs, agent metadata, tool metadata
- Parse MCP tool names of form `mcp__<server>__<tool>` into structured fields

### Span inference strategy (v1)
- Prefer explicit start/end pairs where available
- Fall back to progress/result event pairing by correlation ID or sequence heuristics
- Insert `unknown_gap` spans for large unexplained gaps in an agent lane (configurable threshold)

### Confidence and transparency
Every inferred span/link should store:
- confidence score
- reason code (e.g., `matched_by_uuid`, `matched_by_name_time_window`)

This is essential so the debugger can explain itself and avoid false precision.

---

## Performance and Scale Goals

### v1 targets
- Parse a single session with ~10k-100k JSONL lines in seconds (not minutes)
- Interactive timeline filtering under ~200ms for common queries
- Handle multiple sessions via indexed cache

### Techniques
- Streaming parser
- SQLite indexes on `(session_id, agent_id, ts)` and tool dimensions
- Server-side aggregation for p95/p99 and grouped stats
- Virtualized tables in UI
- Canvas rendering for dense timelines

---

## Security & Privacy

Local-first by default:
- No network calls required for core features
- Bind web UI server to `127.0.0.1`
- No telemetry by default
- Explicit opt-in if diagnostics are added later

Data handling:
- Raw JSON events may contain prompts, code, paths, secrets
- Provide redaction mode for exports (`--redact`)
- Make cache location visible and easy to clear (`cc-trace cache clear`)

---

## CLI + UI Detailed Proposal

### CLI mode matrix

#### `cc-trace open`
- main user workflow
- parse -> cache -> serve -> open browser

Flags:
- `--no-browser`
- `--port <n>`
- `--host 127.0.0.1`
- `--recent <n>`
- `--session <id>`
- `--cache-dir <path>`
- `--reindex`
- `--json` (prints launched URL and session metadata)

#### `cc-trace stats`
Terminal summary for automation and quick checks.

Example output sections:
- Session summary
- Time breakdown
- Top tools (by total / p95)
- Slowest calls
- Errors
- Subagent summary

#### `cc-trace export`
Exports normalized data.

Formats:
- JSON
- NDJSON
- CSV (selected tables)
- Parquet (best for analytics)

---

## TUI vs Web UI Decision

### Recommendation
**Start with web UI only** (plus CLI summary output).

Rationale:
- Timeline + zoom + flamegraph + JSON inspection are far easier in browser
- TUI introduces a second UI system and slows delivery
- A CLI summary already covers headless quick usage

### TUI later (optional)
Add a minimal TUI only if there is clear demand for remote/headless workflows.
Keep scope tight:
- list runs
- top tools
- slow calls
- errors
- no flamegraph in TUI

---

## Suggested Repo Structure

```text
cc-trace/
  packages/
    cli/             # command entrypoints
    parser/          # JSONL parsing + normalization + inference
    db/              # sqlite schema + query layer
    server/          # local API
    web/             # React UI
    shared/          # types, schemas, constants
  docs/
  examples/
  scripts/
```

If monorepo feels heavy, start with a single package and split later. But a small pnpm workspace is a good compromise.

---

## MVP Scope (first usable release)

### Must-have
- Parse one session (main + subagents)
- Normalize tool calls (built-in + MCP)
- Session timeline with agent swimlanes
- Tool stats table with p50/p95/max and errors
- Details panel with raw JSON lines
- `cc-trace open`, `cc-trace stats`

### Nice-to-have (soon after)
- Multi-session explorer
- Icicle/flamegraph view
- Session comparison (before/after)
- Export to Parquet
- Redaction options

### Later / advanced
- Critical path analysis
- Trace diffing with automatic regression detection
- Live tail mode (watch active session files)
- TUI mode

---

## Implementation Phases

### Phase 0 - Spike (1-2 weekends)
- Collect sample JSONL sessions
- Identify raw event shapes
- Prototype parser and tool call extraction
- Validate subagent linking assumptions

Deliverable: CLI script that prints top tool stats and raw counts.

### Phase 1 - Core parser + stats CLI
- Formalize normalized schema
- SQLite cache/index
- `cc-trace stats`
- `cc-trace export`

Deliverable: useful tool profiling from terminal.

### Phase 2 - Local server + Timeline UI
- `cc-trace open`
- session timeline (swimlanes)
- details panel
- tool profiler table

Deliverable: first true debugger UX.

### Phase 3 - Flamegraph/icicle + multi-session explorer
- execution tree view
- session list + filters
- comparison groundwork

Deliverable: broader profiling workflow.

---

## Risks and Mitigations

### Risk: JSONL schema instability across Claude Code versions
Mitigation:
- version-aware parsing
- permissive schemas + unknown field retention
- confidence scores for inferred spans
- test corpus from multiple versions

### Risk: missing/weak correlation IDs for start/end pairing
Mitigation:
- heuristic pairing with explicit confidence
- expose raw events and inference explanations
- mark uncertain spans clearly in UI

### Risk: UI performance on large traces
Mitigation:
- canvas rendering
- server-side aggregation
- virtualization
- downsampled overview timeline + detailed zoom lanes

### Risk: private data exposure in screenshots/exports
Mitigation:
- local-only default
- redaction features
- clear warnings when exporting raw JSON

---

## Recommendation Summary

Build a **CLI-first local profiler** with a **browser-based debugger UI**.

- **CLI command:** `cc-trace`
- **UX:** `cc-trace open <session-or-project-path>` opens a local web UI
- **Stack:** TypeScript + Node + Fastify + SQLite + React/Vite + D3/Canvas
- **MVP focus:** timeline + tool stats + subagent lanes + raw JSON inspection
- **Defer:** TUI and advanced flamegraphs until normalization is solid

This gives you the best mix of installability (including for Claude Code automation), debuggability, and a path to sophisticated performance analysis later.

---

## Appendix: Example User Flows

### Flow A - "Why was this run slow?"
1. `cc-trace open ~/.claude/projects/acme/<session-id>`
2. View time breakdown (Tools 62%, LLM 21%, Hooks 11%, Waiting 6%)
3. Open Tool Profiler -> sort by total duration
4. Discover `mcp__github__search_issues` dominates p95
5. Click slow calls -> inspect raw payloads + errors/retries

### Flow B - "Did subagents help?"
1. Open timeline
2. Enable concurrency chart
3. Compare periods with/without subagent activity
4. Check orchestration overhead and critical path (later feature)
5. Decide whether to reduce subagent fan-out

### Flow C - "Regressed after prompt/tool changes"
1. `cc-trace stats <old-session>` and `<new-session>` (or future compare UI)
2. Compare p95 of key tools and % wall-time in hooks
3. Inspect new long-tail slow MCP calls

