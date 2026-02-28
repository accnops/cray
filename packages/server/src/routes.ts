import { Hono } from "hono";
import { cors } from "hono/cors";
import type { Repository } from "@ccray/db";

export function createApp(repo: Repository) {
  const app = new Hono();

  app.use("*", cors());

  // Sessions
  app.get("/api/sessions", (c) => {
    const sessions = repo.listSessions();
    return c.json(sessions);
  });

  app.get("/api/sessions/:id", (c) => {
    const session = repo.getSession(c.req.param("id"));
    if (!session) {
      return c.json({ error: "Session not found" }, 404);
    }
    return c.json(session);
  });

  app.get("/api/sessions/:id/agents", (c) => {
    const agents = repo.getAgents(c.req.param("id"));
    return c.json(agents);
  });

  app.get("/api/sessions/:id/spans", (c) => {
    const spans = repo.getSpans(c.req.param("id"));
    return c.json(spans);
  });

  app.get("/api/sessions/:id/tools", (c) => {
    const stats = repo.getToolStats(c.req.param("id"));
    return c.json(stats);
  });

  return app;
}
