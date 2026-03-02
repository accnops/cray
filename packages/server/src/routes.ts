import { Hono } from "hono";
import { cors } from "hono/cors";
import { serveStatic } from "hono/bun";
import type { Database } from "bun:sqlite";
import type { Repository } from "@cray/db";
import { discoverProjects, ingestAll, type DiscoveredProject } from "@cray/parser";
import type { DiscoveredProjectSummary, AppConfig, LoadProjectResponse } from "@cray/shared";

export interface AppOptions {
  webRoot?: string;
  mode: "discovery" | "explicit";
  claudeDir?: string;
  projectPath?: string;
  projectName?: string;
}

export function createApp(db: Database, repo: Repository, options: AppOptions) {
  const app = new Hono();

  app.use("/api/*", cors());

  // Config endpoint
  app.get("/api/config", (c) => {
    const config: AppConfig = {
      mode: options.mode,
      projectPath: options.projectPath,
      projectName: options.projectName,
    };
    return c.json(config);
  });

  // Projects list (discovery mode)
  app.get("/api/projects", async (c) => {
    if (!options.claudeDir) {
      return c.json([]);
    }
    const projects = await discoverProjects(options.claudeDir);
    const summaries: DiscoveredProjectSummary[] = projects.map((p: DiscoveredProject) => ({
      projectPath: p.projectPath,
      projectName: p.projectName,
      sessionCount: p.sessions.length,
    }));
    return c.json(summaries);
  });

  // Load project (discovery mode)
  app.post("/api/projects/load", async (c) => {
    const { projectPath } = await c.req.json<{ projectPath: string }>();
    try {
      const sessions = await ingestAll(db, projectPath);
      const response: LoadProjectResponse = {
        success: true,
        sessionCount: sessions.length,
      };
      return c.json(response);
    } catch (e) {
      const response: LoadProjectResponse = {
        success: false,
        sessionCount: 0,
        error: e instanceof Error ? e.message : "Unknown error",
      };
      return c.json(response, 500);
    }
  });

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

  app.get("/api/aggregate", (c) => {
    const sessionIdsParam = c.req.query("sessions");
    const sessionIds = sessionIdsParam ? sessionIdsParam.split(",") : [];

    const startTimeParam = c.req.query("startTime");
    const endTimeParam = c.req.query("endTime");
    const startTime = startTimeParam ? parseInt(startTimeParam, 10) : undefined;
    const endTime = endTimeParam ? parseInt(endTimeParam, 10) : undefined;

    // If no sessions specified, use all
    const ids = sessionIds.length > 0 ? sessionIds : repo.listSessions().map(s => s.sessionId);

    const data = repo.getAggregate(ids, startTime, endTime);
    return c.json(data);
  });

  app.get("/api/messages", (c) => {
    const sessionIdsParam = c.req.query("sessions");
    const sessionIds = sessionIdsParam ? sessionIdsParam.split(",") : [];

    const startTimeParam = c.req.query("startTime");
    const endTimeParam = c.req.query("endTime");
    const startTime = startTimeParam ? parseInt(startTimeParam, 10) : undefined;
    const endTime = endTimeParam ? parseInt(endTimeParam, 10) : undefined;

    // If no sessions specified, use all
    const ids = sessionIds.length > 0 ? sessionIds : repo.listSessions().map(s => s.sessionId);

    const data = repo.getMessages(ids, startTime, endTime);
    return c.json(data);
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
