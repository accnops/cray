import type { ChatMessage, AgentInfo } from "@ccray/shared";
import { ChatMessageItem } from "./ChatMessageItem";

interface AgentPaneProps {
  agent: AgentInfo;
  messages: ChatMessage[];
}

export function AgentPane({ agent, messages }: AgentPaneProps) {
  return (
    <div className="agent-pane">
      <div className="agent-pane-header">{agent.label}</div>
      <div className="agent-pane-messages">
        {messages.map((msg) => (
          <ChatMessageItem key={msg.eventId} message={msg} />
        ))}
      </div>
    </div>
  );
}
