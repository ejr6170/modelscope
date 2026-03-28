import { useState, useEffect, useCallback } from "react";
import type { RefObject } from "react";
import type { Socket } from "socket.io-client";
import type { AgentNode, SessionEvent } from "../types";

export function useAgentState(socketRef: RefObject<Socket | null>) {
  const [completedAgents, setCompletedAgents] = useState<AgentNode[]>([]);
  const [agentEvents, setAgentEvents] = useState<Record<string, SessionEvent[]>>({});

  useEffect(() => {
    const s = socketRef.current;
    if (!s) return;

    const onSubagentEvent = (ev: SessionEvent & { toolUseId?: string; agentId?: string }) => {
      const agentKey = ev.toolUseId || ev.agentId || "";
      if (agentKey) {
        setAgentEvents(prev => {
          const events = prev[agentKey] || [];
          const updated = [...events, ev as SessionEvent];
          return { ...prev, [agentKey]: updated.length > 50 ? updated.slice(-50) : updated };
        });
      }
    };

    const onSubagentEnd = (data: { id: string; type?: string; desc?: string; startTime?: string; result?: string; isError?: boolean }) => {
      setCompletedAgents(prev => {
        const next = [...prev, {
          id: data.id, type: data.type || "", desc: data.desc || "",
          startTime: data.startTime || new Date().toISOString(),
          status: (data.isError ? "failed" : "done") as "active" | "done" | "failed",
          result: data.result, isError: data.isError,
        }];
        return next.length > 50 ? next.slice(-50) : next;
      });
      setAgentEvents(prev => { const copy = { ...prev }; delete copy[data.id]; return copy; });
    };

    s.on("subagent_event", onSubagentEvent);
    s.on("subagent_end", onSubagentEnd);
    return () => { s.off("subagent_event", onSubagentEvent); s.off("subagent_end", onSubagentEnd); };
  }, [socketRef]);

  const resetAgentState = useCallback(() => {
    setCompletedAgents([]);
    setAgentEvents({});
  }, []);

  return { completedAgents, agentEvents, setAgentEvents, resetAgentState };
}
