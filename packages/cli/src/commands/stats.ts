import { Database } from "bun:sqlite";
import { homedir } from "node:os";
import { join } from "node:path";
import { createSchema, Repository } from "@ccray/db";
import { discoverSessions, readJsonlLines, normalizeEvent } from "@ccray/parser";
import { estimateCost } from "@ccray/shared";

export interface StatsOptions {
  json?: boolean;
}

export async function statsCommand(
  path: string | undefined,
  options: StatsOptions
): Promise<void> {
  const targetPath = path ?? join(homedir(), ".claude", "projects");

  // Create in-memory DB for stats
  const db = new Database(":memory:");
  createSchema(db);
  const repo = new Repository(db);

  const sessions = await discoverSessions(targetPath);

  if (sessions.length === 0) {
    console.log("No sessions found.");
    return;
  }

  // Process first session for now
  const session = sessions[0];

  // Parse the session
  const file = Bun.file(session.mainPath);
  const stream = file.stream();

  let lineNo = 0;
  let totalInputTokens = 0;
  let totalOutputTokens = 0;
  let totalCacheRead = 0;
  let totalCacheWrite = 0;
  let startTs = Infinity;
  let endTs = 0;
  let model: string | null = null;

  for await (const raw of readJsonlLines(stream)) {
    lineNo++;
    const event = normalizeEvent(raw, lineNo);

    if (event.ts < startTs) startTs = event.ts;
    if (event.ts > endTs) endTs = event.ts;

    if (event.tokenUsage) {
      totalInputTokens += event.tokenUsage.inputTokens;
      totalOutputTokens += event.tokenUsage.outputTokens;
      totalCacheRead += event.tokenUsage.cacheReadInputTokens;
      totalCacheWrite += event.tokenUsage.cacheCreationInputTokens;
    }

    if (event.model) {
      model = event.model;
    }
  }

  const durationMs = endTs - startTs;
  const cost = estimateCost(
    model,
    totalInputTokens,
    totalOutputTokens,
    totalCacheRead,
    totalCacheWrite
  );

  if (options.json) {
    console.log(JSON.stringify({
      sessionId: session.sessionId,
      durationMs,
      totalInputTokens,
      totalOutputTokens,
      totalCacheReadTokens: totalCacheRead,
      totalCacheWriteTokens: totalCacheWrite,
      estimatedCostUsd: cost,
      model,
    }, null, 2));
  } else {
    console.log(`\nSession: ${session.sessionId}`);
    console.log(`Duration: ${(durationMs / 1000).toFixed(1)}s`);
    console.log(`Model: ${model ?? "unknown"}`);
    console.log(`\nTokens:`);
    console.log(`  Input:       ${totalInputTokens.toLocaleString()}`);
    console.log(`  Output:      ${totalOutputTokens.toLocaleString()}`);
    console.log(`  Cache Read:  ${totalCacheRead.toLocaleString()}`);
    console.log(`  Cache Write: ${totalCacheWrite.toLocaleString()}`);
    console.log(`\nEstimated Cost: $${cost.toFixed(4)}`);
  }

  db.close();
}
