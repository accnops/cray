import { useState, useRef, useEffect } from "react";
import type { Session } from "@ccray/shared";

interface Props {
  sessions: Session[];
  selectedIds: string[];
  onChange: (ids: string[]) => void;
}

export function SessionFilter({ sessions, selectedIds, onChange }: Props) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  // Close on outside click
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

  const toggle = (id: string) => {
    if (selectedIds.includes(id)) {
      onChange(selectedIds.filter((s) => s !== id));
    } else {
      onChange([...selectedIds, id]);
    }
  };

  const selectAll = () => onChange(sessions.map((s) => s.sessionId));
  const clearAll = () => onChange([]);

  return (
    <div className="session-filter" ref={ref}>
      <button className="filter-button" onClick={() => setOpen(!open)}>
        Sessions ({selectedIds.length}/{sessions.length}) ▼
      </button>

      {open && (
        <div className="filter-dropdown">
          <div className="filter-actions">
            <button onClick={selectAll}>Select All</button>
            <button onClick={clearAll}>Clear</button>
          </div>
          <div className="filter-list">
            {sessions.map((s) => (
              <label key={s.sessionId} className="filter-item">
                <input
                  type="checkbox"
                  checked={selectedIds.includes(s.sessionId)}
                  onChange={() => toggle(s.sessionId)}
                />
                <span className="filter-label">
                  <span className="project">{getProjectName(s.projectPath)}</span>
                  <span className="time">{formatRelativeTime(s.startTs)}</span>
                  <span className="message">{truncate(s.firstMessage, 30)}</span>
                </span>
              </label>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function getProjectName(path: string): string {
  const parts = path.split("/");
  const last = parts[parts.length - 1];
  // Remove leading dash prefix from encoded paths
  return last.replace(/^-+/, "").split("-").pop() ?? last;
}

function formatRelativeTime(ts: number): string {
  const diff = Date.now() - ts;
  const minutes = Math.floor(diff / 60000);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);

  if (days > 0) return `${days}d ago`;
  if (hours > 0) return `${hours}h ago`;
  if (minutes > 0) return `${minutes}m ago`;
  return "just now";
}

function truncate(s: string | null, len: number): string {
  if (!s) return "";
  if (s.length <= len) return s;
  return s.slice(0, len) + "...";
}
