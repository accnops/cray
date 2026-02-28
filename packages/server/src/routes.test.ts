import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { Database } from "bun:sqlite";
import { createSchema, Repository } from "@ccray/db";
import { createApp } from "./routes.js";

describe("API routes", () => {
  let db: Database;
  let repo: Repository;
  let app: ReturnType<typeof createApp>;

  beforeEach(() => {
    db = new Database(":memory:");
    createSchema(db);
    repo = new Repository(db);
    app = createApp(repo);

    // Seed test data
    repo.insertSession({
      sessionId: "sess1",
      projectPath: "/test/project",
      startTs: 1000,
      endTs: 2000,
      durationMs: 1000,
      totalInputTokens: 100,
      totalOutputTokens: 50,
      totalCacheReadTokens: 0,
      totalCacheWriteTokens: 0,
      estimatedCostUsd: 0.01,
    });
  });

  afterEach(() => {
    db.close();
  });

  it("GET /api/sessions should return sessions", async () => {
    const res = await app.request("/api/sessions");
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data).toHaveLength(1);
    expect(data[0].sessionId).toBe("sess1");
  });

  it("GET /api/sessions/:id should return single session", async () => {
    const res = await app.request("/api/sessions/sess1");
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.sessionId).toBe("sess1");
  });

  it("GET /api/sessions/:id should return 404 for missing session", async () => {
    const res = await app.request("/api/sessions/nonexistent");

    expect(res.status).toBe(404);
  });
});
