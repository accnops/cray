import { useState, useMemo, useCallback, useRef, useEffect } from "react";
import type { MessagesResponse, AgentInfo } from "@cray/shared";
import { useApi } from "../hooks/useApi";
import { ChatMessageItem } from "./ChatMessageItem";

interface ChatSidebarProps {
  sessionIds: string[];
  timeRange: { start: number; end: number } | null;
  onIndicatorChange?: (ts: number | null) => void;
}

const DEFAULT_WIDTH = 400;
const MIN_WIDTH = 300;
const MAX_WIDTH = 600;
const STORAGE_KEY = "cray-sidebar-width";

export function ChatSidebar({ sessionIds, timeRange, onIndicatorChange }: ChatSidebarProps) {
  const [width, setWidth] = useState(() => {
    const saved = localStorage.getItem(STORAGE_KEY);
    return saved ? parseInt(saved, 10) : DEFAULT_WIDTH;
  });

  const isResizing = useRef(false);
  const listRef = useRef<HTMLDivElement>(null);
  const dotRef = useRef<HTMLDivElement>(null);

  // Handle scroll to update indicator timestamp
  const handleScroll = useCallback(() => {
    if (!dotRef.current || !listRef.current) return;

    const dotRect = dotRef.current.getBoundingClientRect();
    const listRect = listRef.current.getBoundingClientRect();
    const dotCenterY = dotRect.top + dotRect.height / 2;
    // Sample from within the message list, not at the triangle position
    const sampleX = listRect.left + 50;

    // Find element at dot's Y position but inside the message list
    const el = document.elementFromPoint(sampleX, dotCenterY);
    const messageEl = el?.closest('.chat-message');

    if (messageEl) {
      const ts = parseInt(messageEl.getAttribute('data-ts') || '0', 10);
      if (ts > 0) onIndicatorChange?.(ts);
    }
  }, [onIndicatorChange]);

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

  // Call handleScroll on mount and when data changes to set initial indicator
  useEffect(() => {
    if (data && data.messages.length > 0) {
      // Small delay to ensure DOM is rendered
      const timeoutId = setTimeout(handleScroll, 50);
      return () => clearTimeout(timeoutId);
    }
  }, [data, handleScroll]);

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

  return (
    <div className="chat-sidebar" style={{ width }}>
      <div className="sidebar-resize-handle" onMouseDown={handleMouseDown} />

      {loading ? (
        <div className="sidebar-loading">Loading...</div>
      ) : !data || data.messages.length === 0 ? (
        <div className="sidebar-empty">No messages in selected range</div>
      ) : (
        <>
          <div ref={dotRef} className="scroll-indicator-dot" />
          <div ref={listRef} className="messages-list" onScroll={handleScroll}>
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
        </>
      )}
    </div>
  );
}
