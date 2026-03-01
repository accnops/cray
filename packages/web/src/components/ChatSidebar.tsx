import { useState, useMemo, useCallback, useRef, useEffect } from "react";
import type { MessagesResponse, AgentInfo } from "@ccray/shared";
import { useApi } from "../hooks/useApi";
import { ChatMessageItem } from "./ChatMessageItem";

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

  // Build agent lookup for labels
  const agentLookup = useMemo(() => {
    if (!data) return new Map<string, AgentInfo>();
    return new Map(data.agents.map((a) => [a.agentId, a]));
  }, [data]);

  // Check if we have multiple agents (to decide whether to show agent labels)
  const hasMultipleAgents = data && data.agents.length > 1;

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
      <button
        className="collapse-btn sidebar-collapse-btn"
        onClick={() => setCollapsed(true)}
        title="Collapse"
      >
        ▶
      </button>

      {loading ? (
        <div className="sidebar-loading">Loading...</div>
      ) : !data || data.messages.length === 0 ? (
        <div className="sidebar-empty">No messages in selected range</div>
      ) : (
        <div className="messages-list">
          {data.messages.map((msg) => {
            // Only show agent label for subagents when multiple agents exist
            const agent = agentLookup.get(msg.agentId);
            const showLabel = hasMultipleAgents && agent?.kind === "subagent";
            return (
              <ChatMessageItem
                key={msg.eventId}
                message={msg}
                agentLabel={showLabel ? agent?.label : undefined}
              />
            );
          })}
        </div>
      )}
    </div>
  );
}
