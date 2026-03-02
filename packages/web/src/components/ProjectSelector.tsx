import { useState } from "react";
import type { DiscoveredProjectSummary } from "@cray/shared";
import { useApi } from "../hooks/useApi";
import { Logo } from "./Logo";

interface Props {
  onProjectLoad: (projectName: string) => void;
}

function formatProjectName(name: string): string {
  // Convert -Users-name-path-project to just "project"
  const cleaned = name.replace(/^-+/, "");
  return cleaned.split("-").pop() || cleaned || name;
}

export function ProjectSelector({ onProjectLoad }: Props) {
  const { data: projects, loading } = useApi<DiscoveredProjectSummary[]>("/api/projects");
  const [loadingProject, setLoadingProject] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  async function handleSelect(project: DiscoveredProjectSummary) {
    setLoadingProject(project.projectPath);
    setLoadError(null);

    try {
      const res = await fetch("/api/projects/load", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectPath: project.projectPath }),
      });
      const data = await res.json();

      if (data.success) {
        onProjectLoad(formatProjectName(project.projectName));
      } else {
        setLoadError(data.error || "Failed to load project");
      }
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : "Failed to load project");
    } finally {
      setLoadingProject(null);
    }
  }

  if (loading) {
    return (
      <div className="project-selector">
        <div className="selector-loading">
          <Logo size={64} animate />
          <p>Discovering projects...</p>
        </div>
      </div>
    );
  }

  if (!projects || projects.length === 0) {
    return (
      <div className="project-selector">
        <div className="selector-empty">
          <Logo size={64} />
          <h2>No projects found</h2>
          <p>No Claude Code sessions found in ~/.claude/projects</p>
        </div>
      </div>
    );
  }

  return (
    <div className="project-selector">
      <header className="selector-header">
        <Logo size={32} />
        <h1>Select Project</h1>
      </header>

      {loadError && (
        <div className="selector-error">
          {loadError}
        </div>
      )}

      <div className="project-grid">
        {projects.map((project) => {
          const isLoading = loadingProject === project.projectPath;
          return (
            <button
              key={project.projectPath}
              className={`project-card ${isLoading ? "loading" : ""}`}
              onClick={() => handleSelect(project)}
              disabled={loadingProject !== null}
            >
              {isLoading ? (
                <div className="project-loading">
                  <Logo size={24} animate />
                  <span>Loading...</span>
                </div>
              ) : (
                <>
                  <span className="project-name">{formatProjectName(project.projectName)}</span>
                  <span className="project-sessions">
                    {project.sessionCount} session{project.sessionCount !== 1 ? "s" : ""}
                  </span>
                </>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}
