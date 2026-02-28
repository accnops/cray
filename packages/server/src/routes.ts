import { Hono } from "hono";
import { cors } from "hono/cors";
import { serveStatic } from "hono/bun";
import type { Repository } from "@ccray/db";

export interface AppOptions {
  webRoot?: string;
}

export function createApp(repo: Repository, options: AppOptions = {}) {
  const app = new Hono();

  app.use("/api/*", cors());

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

  // Serve static files from web dist
  if (options.webRoot) {
    app.use("/*", serveStatic({ root: options.webRoot }));

    // SPA fallback - serve index.html for client-side routes
    app.get("*", async (c) => {
      const indexPath = `${options.webRoot}/index.html`;
      const file = Bun.file(indexPath);
      if (await file.exists()) {
        return c.html(await file.text());
      }
      return c.text("Not Found", 404);
    });
  }

  return app;
}
