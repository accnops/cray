import { useState, useEffect } from "react";
import type { AppConfig } from "@cray/shared";
import { useApi } from "./hooks/useApi";
import { Dashboard } from "./Dashboard";
import { ProjectSelector } from "./components/ProjectSelector";
import { Logo } from "./components/Logo";

type AppMode = "loading" | "selector" | "dashboard";

interface AppState {
  mode: AppMode;
  projectName?: string;
  explicitPath: boolean;
}

export function App() {
  const [state, setState] = useState<AppState>({ mode: "loading", explicitPath: false });
  const { data: config } = useApi<AppConfig>("/api/config");

  useEffect(() => {
    if (config) {
      if (config.mode === "explicit") {
        setState({ mode: "dashboard", projectName: config.projectName, explicitPath: true });
      } else {
        setState({ mode: "selector", explicitPath: false });
      }
    }
  }, [config]);

  function handleProjectLoad(projectName: string) {
    setState({ mode: "dashboard", projectName, explicitPath: false });
  }

  function handleBackToSelector() {
    setState({ mode: "selector", explicitPath: false });
  }

  if (state.mode === "loading") {
    return (
      <div className="loading-view">
        <Logo size={64} animate />
        <p>Loading...</p>
      </div>
    );
  }

  if (state.mode === "selector") {
    return <ProjectSelector onProjectLoad={handleProjectLoad} />;
  }

  return (
    <Dashboard
      projectName={state.projectName}
      showBackButton={!state.explicitPath}
      onBack={handleBackToSelector}
    />
  );
}
