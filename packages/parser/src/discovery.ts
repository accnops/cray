import { readdir, stat } from "node:fs/promises";
import { join, basename } from "node:path";

export interface DiscoveredSession {
  sessionId: string;
  mainPath: string;
  subagentPaths: string[];
  projectPath: string;
}

export interface DiscoveredProject {
  projectPath: string;
  projectName: string;
  sessions: DiscoveredSession[];
}

export async function discoverSessions(dir: string): Promise<DiscoveredSession[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  const sessions: DiscoveredSession[] = [];

  for (const entry of entries) {
    if (entry.isFile() && entry.name.endsWith(".jsonl")) {
      const sessionId = entry.name.replace(".jsonl", "");
      const mainPath = join(dir, entry.name);

      // Look for subagent files
      const subagentDir = join(dir, "subagents");
      let subagentPaths: string[] = [];

      try {
        const subagentEntries = await readdir(subagentDir);
        subagentPaths = subagentEntries
          .filter(f => f.endsWith(".jsonl"))
          .map(f => join(subagentDir, f));
      } catch {
        // No subagents directory
      }

      sessions.push({
        sessionId,
        mainPath,
        subagentPaths,
        projectPath: dir,
      });
    }
  }

  return sessions;
}

export async function discoverProjects(claudeDir: string): Promise<DiscoveredProject[]> {
  const projectsDir = join(claudeDir, "projects");
  const projects: DiscoveredProject[] = [];

  try {
    const entries = await readdir(projectsDir, { withFileTypes: true });

    for (const entry of entries) {
      if (entry.isDirectory() && !entry.name.startsWith(".")) {
        const projectPath = join(projectsDir, entry.name);
        const sessions = await discoverSessions(projectPath);

        if (sessions.length > 0) {
          projects.push({
            projectPath,
            projectName: entry.name,
            sessions,
          });
        }
      }
    }
  } catch {
    // No projects directory
  }

  return projects;
}
