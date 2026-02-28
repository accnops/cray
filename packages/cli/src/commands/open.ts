import { Database } from "bun:sqlite";
import { homedir } from "node:os";
import { join, dirname } from "node:path";
import { mkdir } from "node:fs/promises";
import { createSchema, Repository } from "@ccray/db";
import { createApp } from "@ccray/server";
import { ingestAll } from "@ccray/parser";

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
}

export async function openCommand(
  path: string | undefined,
  options: OpenOptions
): Promise<void> {
  const port = options.port ? parseInt(options.port as unknown as string, 10) : 3333;
  const targetPath = path ?? join(homedir(), ".claude", "projects");
  const cacheDir = join(homedir(), ".cache", "ccray");
  const dbPath = join(cacheDir, "ccray.db");

  // Ensure cache directory exists
  await mkdir(cacheDir, { recursive: true });

  console.log(`Scanning ${targetPath}...`);

  const db = new Database(dbPath);

  // Ingest sessions
  const sessions = await ingestAll(db, targetPath, { reindex: options.reindex });

  if (sessions.length === 0) {
    console.log("No sessions found.");
    db.close();
    return;
  }

  console.log(`\nIngested ${sessions.length} session(s)`);

  const repo = new Repository(db);
  const webRoot = await findWebRoot();

  if (webRoot) {
    console.log(`Serving web UI from ${webRoot}`);
  } else {
    console.log("Warning: Web UI not found. API-only mode.");
  }

  const app = createApp(repo, { webRoot });

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
