import { Database } from "bun:sqlite";
import { homedir } from "node:os";
import { join, dirname, basename } from "node:path";
import { mkdir } from "node:fs/promises";
import { createSchema, Repository } from "@cray/db";
import { createApp } from "@cray/server";
import { ingestAll } from "@cray/parser";

interface TimeBreakdownEntry {
  name: string;
  type: "llm" | "builtin" | "mcp";
  calls: number;
  totalMs: number;
  wallClockMs: number;
  pctOfSession: number;
  avgMs: number;
  p95Ms: number;
  errors: number;
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${Math.round(ms)}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  return `${(ms / 60000).toFixed(1)}m`;
}

function printTimeBreakdown(breakdown: TimeBreakdownEntry[], totalDurationMs: number): void {
  if (breakdown.length === 0) {
    console.log("No time breakdown data available.");
    return;
  }

  // Column headers
  const headers = ["Name", "Type", "Calls", "Wall Clock", "% Session", "Avg", "P95"];

  // Build rows
  const rows = breakdown.map(entry => [
    entry.name,
    entry.type,
    entry.calls.toString(),
    formatDuration(entry.wallClockMs),
    `${entry.pctOfSession.toFixed(1)}%`,
    formatDuration(entry.avgMs),
    formatDuration(entry.p95Ms),
  ]);

  // Calculate column widths
  const colWidths = headers.map((h, i) =>
    Math.max(h.length, ...rows.map(r => r[i].length))
  );

  // Print header
  const headerLine = headers.map((h, i) => h.padEnd(colWidths[i])).join("  ");
  console.log(`\n${headerLine}`);
  console.log("-".repeat(headerLine.length));

  // Print rows
  for (const row of rows) {
    console.log(row.map((cell, i) => cell.padEnd(colWidths[i])).join("  "));
  }

  // Print total
  console.log("-".repeat(headerLine.length));
  console.log(`Total active time: ${formatDuration(totalDurationMs)}`);
}

async function findWebRoot(): Promise<string | undefined> {
  // Try relative to current working directory (development)
  const devPath = join(process.cwd(), "packages", "web", "dist");
  const devFile = Bun.file(join(devPath, "index.html"));
  if (await devFile.exists()) {
    return devPath;
  }

  // Try relative to executable (compiled binary)
  const exePath = process.execPath;
  const exeDir = dirname(exePath);
  const exeWebPath = join(exeDir, "web");
  const exeFile = Bun.file(join(exeWebPath, "index.html"));
  if (await exeFile.exists()) {
    return exeWebPath;
  }

  return undefined;
}

export interface OpenOptions {
  port?: number;
  noBrowser?: boolean;
  reindex?: boolean;
  timeBreakdown?: boolean;
}

export async function openCommand(
  path: string | undefined,
  options: OpenOptions
): Promise<void> {
  // --time-breakdown requires a path
  if (options.timeBreakdown && !path) {
    console.error("Error: --time-breakdown requires a path argument");
    process.exit(1);
  }

  const port = options.port ? parseInt(options.port as unknown as string, 10) : 3333;
  const claudeDir = join(homedir(), ".claude");
  const explicitPath = path !== undefined;
  const cacheDir = join(homedir(), ".cache", "cray");
  const dbPath = join(cacheDir, "cray.db");

  // Ensure cache directory exists
  await mkdir(cacheDir, { recursive: true });

  const db = new Database(dbPath);

  let appMode: "discovery" | "explicit" = "discovery";
  let projectPath: string | undefined;
  let projectName: string | undefined;

  if (explicitPath) {
    // Explicit path: ingest immediately (current behavior)
    appMode = "explicit";
    projectPath = path;
    projectName = basename(path);

    console.log(`Scanning ${projectPath}...`);
    const sessions = await ingestAll(db, projectPath, { reindex: options.reindex });

    if (sessions.length === 0) {
      console.log("No sessions found.");
      db.close();
      return;
    }

    // Handle --time-breakdown option
    if (options.timeBreakdown) {
      const repo = new Repository(db);
      const sessionIds = sessions.map(s => s.sessionId);
      const aggregate = repo.getAggregate(sessionIds);

      printTimeBreakdown(aggregate.timeBreakdown, aggregate.totals.durationMs);
      db.close();
      return;
    }

    console.log(`\nIngested ${sessions.length} session(s)`);
  } else {
    console.log("Starting in project selector mode...");
    createSchema(db);
  }

  const repo = new Repository(db);
  const webRoot = await findWebRoot();

  if (webRoot) {
    console.log(`Serving web UI from ${webRoot}`);
  } else {
    console.log("Warning: Web UI not found. API-only mode.");
  }

  const app = createApp(db, repo, {
    webRoot,
    mode: appMode,
    claudeDir: explicitPath ? undefined : claudeDir,
    projectPath,
    projectName,
  });

  console.log(`\nStarting server on http://127.0.0.1:${port}`);

  Bun.serve({
    port,
    hostname: "127.0.0.1",
    fetch: app.fetch,
  });

  if (!options.noBrowser) {
    const cmd = process.platform === "darwin" ? "open" : "xdg-open";
    Bun.spawn([cmd, `http://127.0.0.1:${port}`]);
  }

  console.log("Press Ctrl+C to stop");

  // Keep process running
  await new Promise(() => {});
}
