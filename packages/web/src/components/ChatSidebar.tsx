import { useState, useMemo, useCallback, useRef, useEffect } from "react";
import type { MessagesResponse } from "@ccray/shared";
import { useApi } from "../hooks/useApi";
import { AgentPane } from "./AgentPane";

interface ChatSidebarProps {
  sessionIds: string[];
  timeRange: { start: number; end: number } | null;
}

const DEFAULT_WIDTH = 400;
const MIN_WIDTH = 300;
const MAX_WIDTH = 600;
const STORAGE_KEY = "ccray-sidebar-width";

export function ChatSidebar({ sessionIds, timeRange }: ChatSidebarProps) {
  const [collapsed, setCollapsed] = useState(false);
  const [width, setWidth] = useState(() => {
    const saved = localStorage.getItem(STORAGE_KEY);
    return saved ? parseInt(saved, 10) : DEFAULT_WIDTH;
  });

  const isResizing = useRef(false);

  // Build query string
  const queryString = useMemo(() => {
    const params = new URLSearchParams();
    if (sessionIds.length > 0) {
      params.set("sessions", sessionIds.join(","));
    }
    if (timeRange) {
      params.set("startTime", timeRange.start.toString());
      params.set("endTime", timeRange.end.toString());
    }
    const str = params.toString();
    return str ? `?${str}` : "";
  }, [sessionIds, timeRange]);

  const { data, loading } = useApi<MessagesResponse>(
    sessionIds.length > 0 ? `/api/messages${queryString}` : null
  );

  // Group messages by agent
  const messagesByAgent = useMemo(() => {
    if (!data) return new Map();
    const map = new Map<string, typeof data.messages>();
    for (const msg of data.messages) {
      const existing = map.get(msg.agentId) ?? [];
      existing.push(msg);
      map.set(msg.agentId, existing);
    }
    return map;
  }, [data]);

  // Resize handling
  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    isResizing.current = true;
    document.body.style.cursor = "ew-resize";
    document.body.style.userSelect = "none";
  }, []);

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (!isResizing.current) return;
      const newWidth = window.innerWidth - e.clientX;
      const clamped = Math.max(MIN_WIDTH, Math.min(MAX_WIDTH, newWidth));
      setWidth(clamped);
    };

    const handleMouseUp = () => {
      if (isResizing.current) {
        isResizing.current = false;
        document.body.style.cursor = "";
        document.body.style.userSelect = "";
        localStorage.setItem(STORAGE_KEY, width.toString());
      }
    };

    document.addEventListener("mousemove", handleMouseMove);
    document.addEventListener("mouseup", handleMouseUp);
    return () => {
      document.removeEventListener("mousemove", handleMouseMove);
      document.removeEventListener("mouseup", handleMouseUp);
    };
  }, [width]);

  if (collapsed) {
    return (
      <div className="chat-sidebar collapsed">
        <button className="collapse-btn" onClick={() => setCollapsed(false)} title="Expand">
          ◀
        </button>
      </div>
    );
  }

  return (
    <div className="chat-sidebar" style={{ width }}>
      <div className="sidebar-resize-handle" onMouseDown={handleMouseDown} />
      <div className="sidebar-header">
        <h3>Chat</h3>
        <button className="collapse-btn" onClick={() => setCollapsed(true)} title="Collapse">
          ▶
        </button>
      </div>

      {loading ? (
        <div className="sidebar-loading">Loading...</div>
      ) : !data || data.messages.length === 0 ? (
        <div className="sidebar-empty">No messages in selected range</div>
      ) : (
        <div className="agent-panes">
          {data.agents.map((agent) => (
            <AgentPane
              key={agent.agentId}
              agent={agent}
              messages={messagesByAgent.get(agent.agentId) ?? []}
            />
          ))}
        </div>
      )}
    </div>
  );
}
