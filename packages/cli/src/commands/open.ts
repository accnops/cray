import { Database } from "bun:sqlite";
import { homedir } from "node:os";
import { join } from "node:path";
import { createSchema, Repository } from "@ccray/db";
import { createApp } from "@ccray/server";

export interface OpenOptions {
  port?: number;
  noBrowser?: boolean;
}

export async function openCommand(
  path: string | undefined,
  options: OpenOptions
): Promise<void> {
  const port = options.port ?? 3333;
  const cacheDir = join(homedir(), ".cache", "ccray");
  const dbPath = join(cacheDir, "ccray.db");

  // Ensure cache directory exists
  await Bun.write(join(cacheDir, ".keep"), "");

  const db = new Database(dbPath);
  createSchema(db);
  const repo = new Repository(db);

  const app = createApp(repo);

  console.log(`Starting ccray server on http://127.0.0.1:${port}`);

  Bun.serve({
    port,
    hostname: "127.0.0.1",
    fetch: app.fetch,
  });

  if (!options.noBrowser) {
    // Open browser (platform-specific)
    const cmd = process.platform === "darwin" ? "open" : "xdg-open";
    Bun.spawn([cmd, `http://127.0.0.1:${port}`]);
  }

  // Keep process running
  await new Promise(() => {});
}
