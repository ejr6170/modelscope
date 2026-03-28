"use client";

import React, { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { io, Socket } from "socket.io-client";
import type { SessionEvent, Metrics, SessionInfo, PinnedError, ProjectInfo, FeedCard, HudSettings, AgentNode, HwMetrics } from "./types";
import { formatDuration, ProgressRing, ProgressBar, SideMetric, CpuIcon, ZapIcon, DollarIcon, ClockIcon, LayersIcon, WrenchIcon } from "./shared";
import { useSettings, SettingsModal } from "./SettingsModal";
import { eventToCards, CardRouter, cardMotion, cardTr, formatTranscriptTool } from "./cards/CardRouter";
import { FlowView } from "./views/FlowView";
import { AgentsView } from "./views/AgentsView";
import { MonitorView } from "./views/MonitorView";
import { StatusBar } from "./StatusBar";
import { Sidebar, SessionPanel } from "./Sidebar";
import { CommandBar } from "./CommandBar";
import { useHardwareMetrics } from "./hooks/useHardwareMetrics";
import { useAgentState } from "./hooks/useAgentState";

function PinnedErrors({ errors, onDismiss }: { errors: PinnedError[]; onDismiss: (id: string) => void }) {
  if (!errors.length) return null;
  return (
    <div className="px-3 pt-2 space-y-1.5">
      {errors.slice(-3).map(err => (
        <motion.div key={err.id} initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }}
          className="flex items-start gap-2 px-3 py-2 rounded-lg bg-red-500/[0.10] border border-red-400/20 cursor-pointer hover:bg-red-500/[0.15] transition-colors"
          style={{ boxShadow: "0 0 12px rgba(255, 0, 0, 0.15)" }}
          onClick={() => onDismiss(err.id)}>
          <span className="text-[9px] font-mono font-bold text-red-400 mt-0.5 shrink-0">{"\u26a0"}</span>
          <p className="text-[9px] font-mono text-red-300/70 flex-1 leading-relaxed">{err.content.slice(0, 120)}</p>
          <span className="text-[8px] text-red-400/40 shrink-0">{"\u2715"}</span>
        </motion.div>
      ))}
    </div>
  );
}



const MAX_CARDS = 60;
function createDefaultMetrics(): Metrics {
  return { tokens: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, cost: 0, turns: 0, toolCalls: 0, elapsed: 0, velocity: 0, startTime: Date.now(), hourlyTurns: 0, topFiles: [], errorCount: 0, activeSubagents: [], plan: undefined, modelBreakdown: [], usage: undefined };
}


export default function Dashboard() {
  const [connected, setConnected] = useState(false);
  const [session, setSession] = useState<SessionInfo | null>(null);
  const [cards, setCards] = useState<FeedCard[]>([]);
  const [metrics, setMetrics] = useState<Metrics>(createDefaultMetrics);
  const [model, setModel] = useState("");
  const [pinnedErrors, setPinnedErrors] = useState<PinnedError[]>([]);
  const [projects, setProjects] = useState<ProjectInfo[]>([]);
  const [activeProjectId, setActiveProjectId] = useState<string | null>(null);
  const [highlightedCardId, setHighlightedCardId] = useState<string | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [activeView, setActiveView] = useState("feed");
  const [updateStatus, setUpdateStatus] = useState("idle");
  const [fileTargets, setFileTargets] = useState<Record<string, "neutral" | "snipe" | "focus">>({});
  const { hardwareMetrics, hardwareHistory } = useHardwareMetrics();
  const feedRef = useRef<HTMLDivElement>(null);
  const autoScroll = useRef(true);
  const socketRef = useRef<Socket | null>(null);
  const highlightTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const { completedAgents, agentEvents, setAgentEvents, resetAgentState } = useAgentState(socketRef);
  const [settings, updateSettings, resetSettings] = useSettings();

  const overBudget = settings.sessionBudget > 0 && metrics.cost > settings.sessionBudget;

  const cycleFileTarget = useCallback((file: string) => {
    setFileTargets(prev => {
      const current = prev[file] || "neutral";
      const next = current === "neutral" ? "focus" : current === "focus" ? "snipe" : "neutral";
      return { ...prev, [file]: next };
    });
  }, []);

  const snipedFiles = useMemo(() => Object.entries(fileTargets).filter(([, v]) => v === "snipe").map(([k]) => k), [fileTargets]);

  const onScroll = useCallback(() => { if (!feedRef.current) return; autoScroll.current = feedRef.current.scrollHeight - feedRef.current.scrollTop - feedRef.current.clientHeight < 80; }, []);
  const scrollBottom = useCallback(() => { if (autoScroll.current && feedRef.current) feedRef.current.scrollTop = feedRef.current.scrollHeight; }, []);
  const scrollBottomRef = useRef(scrollBottom);
  useEffect(() => { scrollBottomRef.current = scrollBottom; });

  const dismissError = useCallback((id: string) => {
    setPinnedErrors(prev => prev.filter(e => e.id !== id));
    socketRef.current?.emit("dismiss_error", id);
  }, []);

  useEffect(() => {
    const api = (window as unknown as Record<string, Record<string, (cb: (s: string) => void) => void>>).electronAPI;
    api?.onUpdateStatus?.((status: string) => setUpdateStatus(status));
  }, []);

  const switchProject = useCallback((projectId: string) => {
    setActiveProjectId(projectId);
    setCards([]);
    setModel("");
    setMetrics(createDefaultMetrics());
    setPinnedErrors([]);
    setSession(null);
    resetAgentState();
    socketRef.current?.emit("switch_project", projectId);
  }, []);

  const jumpToCard = useCallback((cardId: string) => {
    const el = document.getElementById(`card-${cardId}`);
    if (el && feedRef.current) {
      el.scrollIntoView({ behavior: "smooth", block: "center" });
      setHighlightedCardId(cardId);
      if (highlightTimerRef.current) clearTimeout(highlightTimerRef.current);
      highlightTimerRef.current = setTimeout(() => setHighlightedCardId(null), 2000);
    }
  }, []);

  const openSettings = useCallback(() => setSettingsOpen(true), []);
  const closeSettings = useCallback(() => setSettingsOpen(false), []);
  const resetStats = useCallback(() => socketRef.current?.emit("reset_stats"), []);
  const handleRateLimit = useCallback((data: { status: string; resetsAt: string }) => {
    socketRef.current?.emit("rate_limit", data);
  }, []);

  useEffect(() => () => {
    if (highlightTimerRef.current) clearTimeout(highlightTimerRef.current);
  }, []);

  useEffect(() => { const iv = setInterval(() => setMetrics(p => ({ ...p, elapsed: Date.now() - p.startTime })), 5000); return () => clearInterval(iv); }, []);

  useEffect(() => {
    const s = io("http://localhost:3778", { autoConnect: true, transports: ["websocket", "polling"], reconnection: true, reconnectionDelay: 1000 });
    socketRef.current = s;

    s.on("connect", () => setConnected(true));
    s.on("disconnect", () => setConnected(false));

    s.on("session", (sessionInfo: SessionInfo | null) => {
      setSession(sessionInfo);
      if (sessionInfo === null) {
        setCards([]);
        setPinnedErrors([]);
      }
    });

    s.on("metrics", (metricsData: Metrics) => setMetrics(metricsData));

    s.on("projects_list", (list: ProjectInfo[]) => {
      setProjects(list);
      setActiveProjectId(prev => {
        if (prev) return prev;
        return list.length > 0 ? list[0].id : null;
      });
    });

    s.on("history", (evts: SessionEvent[]) => {
      const historyCards: FeedCard[] = [];
      for (const ev of evts) { historyCards.push(...eventToCards(ev)); if (ev.model) setModel(ev.model); }
      setCards(historyCards.slice(-MAX_CARDS));
      setTimeout(() => scrollBottomRef.current(), 150);
    });

    s.on("event", (ev: SessionEvent) => {
      const newCards = eventToCards(ev); if (!newCards.length) return;
      if (ev.model) setModel(ev.model);
      setCards(p => { const combined = [...p, ...newCards]; return combined.length > MAX_CARDS ? combined.slice(-MAX_CARDS) : combined; });
      setTimeout(() => scrollBottomRef.current(), 80);
    });

    s.on("subagent_event", (ev: SessionEvent & { toolUseId?: string; agentId?: string }) => {
      const newCards = eventToCards(ev); if (!newCards.length) return;
      setCards(p => { const combined = [...p, ...newCards]; return combined.length > MAX_CARDS ? combined.slice(-MAX_CARDS) : combined; });
      setTimeout(() => scrollBottomRef.current(), 80);
    });

    s.on("pinned_errors", (errs: PinnedError[]) => setPinnedErrors(errs));
    s.on("error_pinned", (err: PinnedError) => setPinnedErrors(p => [...p.slice(-9), err]));
    s.on("usage_updated", (data: Metrics["usage"]) => {
      setMetrics(prev => ({ ...prev, usage: data }));
    });

    return () => { s.disconnect(); };
  }, []);

  return (
    <div className={`h-screen w-screen flex flex-col overflow-hidden rounded-2xl border ${overBudget ? "border-red-500/50 animate-pulse" : "border-white/[0.10]"}`}
         {...(settings.simpleHotspots ? { "data-simple-hotspots": true } : {})}
         style={{
           background: `rgba(13, 14, 18, ${settings.glassOpacity})`,
           backdropFilter: settings.blurIntensity === "none" ? "none" : `blur(${settings.blurIntensity === "high" ? 30 : 12}px)`,
           WebkitBackdropFilter: settings.blurIntensity === "none" ? "none" : `blur(${settings.blurIntensity === "high" ? 30 : 12}px)`,
           boxShadow: "0 8px 32px rgba(0,0,0,0.4)",
         }}>
      <StatusBar connected={connected} onOpenSettings={openSettings} activeView={activeView} onViewChange={setActiveView} updateStatus={updateStatus} />

      <div className="flex-1 flex min-h-0 h-full">
        <div className="w-[180px] shrink-0 h-full border-r border-white/[0.10] p-0 m-0 relative z-10"
             style={settings.sidebarShadows ? { boxShadow: "8px 0 16px rgba(0,0,0,0.3)" } : undefined}>
          <SessionPanel projects={projects} activeProjectId={activeProjectId} onSelect={switchProject} />
        </div>

        <div className="flex-1 w-0 min-w-0 h-full flex flex-col mx-[-1px] p-0 m-0 relative z-0">
          <AnimatePresence mode="popLayout">
            {activeView === "feed" && (
              <motion.div key="feed-view" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0, position: "absolute" as const, inset: 0 }} transition={{ duration: 0.15 }} className="flex-1 flex flex-col min-h-0">
                <PinnedErrors errors={pinnedErrors} onDismiss={dismissError} />
                <div ref={feedRef} onScroll={onScroll} data-feed className="flex-1 overflow-y-auto overflow-x-hidden">
                  {cards.length === 0 ? (
                    <div className="flex items-center justify-center h-full">
                      <div className="text-center space-y-3">
                        <div className="mx-auto w-10 h-10 rounded-full border border-white/[0.07] flex items-center justify-center bg-white/[0.03]">
                          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="text-txt-secondary"><path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Z" /><circle cx="12" cy="12" r="3" /></svg>
                        </div>
                        <p className="text-[11px] font-sans font-medium text-txt-secondary">Observing</p>
                        <p className="text-[9px] font-sans text-txt-tertiary">Replaying last 5 minutes...</p>
                      </div>
                    </div>
                  ) : (
                    <div className="p-3 space-y-2.5">
                      <AnimatePresence initial={false}>
                        {cards.map((card, i) => (
                          <motion.div key={card.id} id={`card-${card.id}`} variants={cardMotion} initial="initial" animate="animate"
                            transition={{ ...cardTr, delay: i >= cards.length - 4 ? (cards.length - 1 - i) * 0.04 : 0 }}
                            className={highlightedCardId === card.id ? "card-highlight-pulse rounded-xl" : ""}>
                            <CardRouter card={card} />
                          </motion.div>
                        ))}
                      </AnimatePresence>
                    </div>
                  )}
                </div>
              </motion.div>
            )}
            {activeView === "agents" && (
              <motion.div key="agents-view" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0, position: "absolute" as const, inset: 0 }} transition={{ duration: 0.15 }} className="flex-1 min-h-0">
                <AgentsView
                  activeAgents={metrics.activeSubagents || []}
                  completedAgents={completedAgents}
                  agentEvents={agentEvents}
                  session={session}
                  metrics={metrics}
                />
              </motion.div>
            )}
            {activeView === "flow" && (
              <motion.div key="flow-view" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0, position: "absolute" as const, inset: 0 }} transition={{ duration: 0.15 }} className="flex-1 min-h-0">
                <FlowView metrics={metrics} />
              </motion.div>
            )}
            {activeView === "monitor" && (
              <motion.div key="monitor-view" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0, position: "absolute" as const, inset: 0 }} transition={{ duration: 0.15 }} className="flex-1 min-h-0">
                <MonitorView current={hardwareMetrics} history={hardwareHistory} />
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        <div className="w-[180px] shrink-0 h-full border-l border-white/[0.10] p-0 m-0 relative z-10"
             style={settings.sidebarShadows ? { boxShadow: "-8px 0 16px rgba(0,0,0,0.3)" } : undefined}>
          <Sidebar metrics={metrics} model={model} session={session} onReset={resetStats} fileTargets={fileTargets} onCycleTarget={cycleFileTarget} snipedCount={snipedFiles.length} hardwareMetrics={hardwareMetrics} />
        </div>
      </div>

      <CommandBar onRateLimit={handleRateLimit} />

      <AnimatePresence>
        {settingsOpen && <SettingsModal settings={settings} onUpdate={updateSettings} onReset={resetSettings} onClose={closeSettings} />}
      </AnimatePresence>
    </div>
  );
}
