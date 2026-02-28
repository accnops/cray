import { Routes, Route } from "react-router-dom";
import { SessionExplorer } from "./pages/SessionExplorer";
import { SessionView } from "./pages/SessionView";

export function App() {
  return (
    <div className="app">
      <header className="app-header">
        <h1>ccray</h1>
        <span className="subtitle">Claude Code Trace Debugger</span>
      </header>
      <main>
        <Routes>
          <Route path="/" element={<SessionExplorer />} />
          <Route path="/session/:id" element={<SessionView />} />
        </Routes>
      </main>
    </div>
  );
}
