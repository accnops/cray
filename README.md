# cray

See what Claude Code is doing.

A local profiler and debugger for Claude Code sessions. Visualize token usage and tool calls.

## Install

```bash
curl -fsSL https://cray.my/install | sh
```

## Usage

```bash
# Open the dashboard for all sessions
cray

# Analyze a specific project
cray ~/.claude/projects/myproject

# Print time breakdown in terminal (no UI)
cray --time-breakdown
```

## Features

- **Token usage over time** — See input, output, and cache tokens across your session timeline
- **Tool breakdown** — Understand which tools take time, see call counts, latencies, and errors
- **Local only** — Runs entirely on your machine, no data leaves your computer

## Development

```bash
# Install dependencies
pnpm install

# Build
pnpm build

# Run locally
./dist/cray
```

## License

MIT
