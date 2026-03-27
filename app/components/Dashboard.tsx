"use client";

import React, { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { io, Socket } from "socket.io-client";
import type { SessionEvent, CursorMetrics, Metrics, SessionInfo, PinnedError, ProjectInfo, FeedCard, HudSettings, AgentNode, HwMetrics } from "./types";
import { ringColor, modelColor, formatDuration, ProgressRing, ProgressBar, SideMetric, CpuIcon, ZapIcon, DollarIcon, ClockIcon, LayersIcon, WrenchIcon } from "./shared";
import { useSettings, SettingsModal } from "./SettingsModal";
import { eventToCards, CardRouter, cardMotion, cardTr, formatTranscriptTool, Timestamp } from "./cards/CardRouter";
import { CodeLines, DiffLines } from "./cards/CodeLines";

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

function SessionPanel({ projects, activeProjectId, onSelect }: { projects: ProjectInfo[]; activeProjectId: string | null; onSelect: (id: string) => void }) {
  return (
    <div className="w-full h-full flex flex-col" style={{ background: "var(--sidebar-bg)", backdropFilter: "blur(50px) saturate(160%)" }}>
      <div className="flex items-center px-3 py-2.5 border-b border-white/[0.06] shrink-0">
        <span className="text-[8px] font-sans font-bold tracking-[0.2em] uppercase text-txt-tertiary">Sessions</span>
        <div className="flex-1" />
        <span className="text-[7px] font-mono text-txt-tertiary">{projects.length}</span>
      </div>
      <div className="flex-1 overflow-y-auto px-1.5 py-1.5 space-y-0.5">
        {projects.length === 0 && (
          <p className="text-[8px] font-mono text-txt-tertiary text-center mt-4">No sessions found</p>
        )}
        {projects.map(p => {
          const isActive = p.id === activeProjectId;
          const name = p.name.replace(/^C--Users-[^-]+-/, "").replace(/-/g, "/");
          const shortName = name.split("/").slice(-2).join("/");
          return (
            <button key={p.id} onClick={() => onSelect(p.id)}
              className={`w-full flex items-center gap-2 px-2.5 py-2 rounded-md text-left transition-all ${isActive ? "bg-indigo-500/10 border-l-2 border-indigo-400/60" : "hover:bg-white/[0.03] border-l-2 border-transparent"}`}>
              <div className={`w-1.5 h-1.5 rounded-full shrink-0 ${p.isLive ? "bg-green-400 animate-pulse" : "bg-white/20"}`} />
              <span className={`text-[9px] font-mono truncate ${isActive ? "text-txt-primary" : "text-txt-secondary"}`}>{shortName}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}


function AgentChangesView({ events }: { events: SessionEvent[] }) {
  const [expandedFile, setExpandedFile] = useState<string | null>(null);

  const codeCards = useMemo(() => {
    const cards: FeedCard[] = [];
    for (const ev of events) cards.push(...eventToCards(ev).filter(c => c.kind === "code"));
    return cards;
  }, [events]);

  const grouped = useMemo(() => {
    const map = new Map<string, FeedCard[]>();
    for (const card of codeCards) {
      const key = card.filename || "unknown";
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(card);
    }
    return Array.from(map.entries()).sort((a, b) => {
      const lastA = a[1][a[1].length - 1]?.timestamp || "";
      const lastB = b[1][b[1].length - 1]?.timestamp || "";
      return lastB.localeCompare(lastA);
    });
  }, [codeCards]);

  const fileCount = grouped.length;
  const changeCount = codeCards.length;

  if (fileCount === 0) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <div className="text-center space-y-2">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="mx-auto text-txt-tertiary/30">
            <path d="M13 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z" /><polyline points="13 2 13 9 20 9" />
          </svg>
          <p className="text-[9px] font-mono text-txt-tertiary">No code changes yet</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-y-auto px-3 py-2">
      <div className="flex items-center gap-2 mb-3">
        <span className="text-[8px] font-mono text-txt-secondary">{fileCount} file{fileCount !== 1 ? "s" : ""} changed</span>
        <span className="text-[8px] font-mono text-txt-tertiary">&middot;</span>
        <span className="text-[8px] font-mono text-txt-tertiary">{changeCount} change{changeCount !== 1 ? "s" : ""}</span>
      </div>

      <div className="space-y-1.5">
        {grouped.map(([filename, cards]) => {
          const isExpanded = expandedFile === filename;
          const editCount = cards.filter(c => !!c.diff).length;
          const writeCount = cards.length - editCount;

          return (
            <div key={filename} className="rounded-lg border border-white/[0.06] overflow-hidden" style={{ background: "rgba(255,255,255,0.015)" }}>
              <button onClick={() => setExpandedFile(isExpanded ? null : filename)}
                className="w-full flex items-center gap-2 px-3 py-2 hover:bg-white/[0.03] transition-colors text-left">
                <svg width="8" height="8" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"
                  className={`text-txt-tertiary transition-transform shrink-0 ${isExpanded ? "rotate-90" : ""}`}>
                  <polyline points="9 18 15 12 9 6" />
                </svg>
                <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="text-txt-secondary shrink-0">
                  <path d="M13 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z" /><polyline points="13 2 13 9 20 9" />
                </svg>
                <span className="text-[9px] font-mono text-txt-secondary truncate flex-1">{filename}</span>
                <div className="flex items-center gap-1 shrink-0">
                  {editCount > 0 && <span className="text-[7px] font-mono px-1.5 py-0.5 rounded bg-amber-500/15 text-amber-400/80">{editCount} edit{editCount !== 1 ? "s" : ""}</span>}
                  {writeCount > 0 && <span className="text-[7px] font-mono px-1.5 py-0.5 rounded bg-emerald-500/15 text-emerald-400/80">{writeCount} write{writeCount !== 1 ? "s" : ""}</span>}
                </div>
              </button>

              <AnimatePresence>
                {isExpanded && (
                  <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={{ duration: 0.25 }}>
                    <div className="border-t border-white/[0.04] px-3 py-2 space-y-2">
                      {cards.map(card => (
                        <div key={card.id}>
                          <div className="flex items-center gap-2 mb-1">
                            <span className={`text-[7px] font-mono font-bold px-1 py-0.5 rounded tracking-wider uppercase ${card.diff ? "bg-amber-500/15 text-amber-400/80" : card.isNewFile ? "bg-emerald-500/20 text-emerald-400" : "bg-emerald-500/15 text-emerald-400/80"}`}>
                              {card.diff ? "diff" : card.isNewFile ? "new" : "write"}
                            </span>
                            {card.lineInfo && <span className="text-[7px] font-mono text-cyan-400/60">L{card.lineInfo.startLine}&ndash;L{card.lineInfo.endLine}</span>}
                            <Timestamp ts={card.timestamp} />
                          </div>
                          <div className="rounded-lg overflow-hidden border border-code-border" style={{ background: "var(--code-bg)" }}>
                            <div className="px-3 py-2 overflow-x-auto">
                              {card.diff
                                ? <DiffLines removed={card.diff.removed} added={card.diff.added} maxLines={20} showLineNums={true} startLine={card.lineInfo?.startLine || 1} />
                                : <CodeLines code={card.code || ""} maxLines={20} showLineNums={true} startLine={card.lineInfo?.startLine || 1} isNewFile={card.isNewFile} />
                              }
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          );
        })}
      </div>
    </div>
  );
}

const AgentsView = React.memo(function AgentsView({ activeAgents, completedAgents, agentEvents, session, metrics }: {
  activeAgents: { id: string; type?: string; desc?: string; startTime?: string; background?: boolean }[];
  completedAgents: AgentNode[];
  agentEvents: Record<string, SessionEvent[]>;
  session: SessionInfo | null;
  metrics: Metrics;
}) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detailTab, setDetailTab] = useState<"activity" | "changes">("activity");

  useEffect(() => { setDetailTab("activity"); }, [selectedId]);

  const selectedEvents = agentEvents[selectedId || ""] || [];
  const selectedCards = useMemo(() => selectedEvents.flatMap(ev => eventToCards(ev)), [selectedEvents]);

  const allAgents = useMemo(() => {
    const agents: (AgentNode & { status: "active" | "done" | "failed" })[] = [];
    for (const a of activeAgents) {
      agents.push({ id: a.id, type: a.type || "", desc: a.desc || "", startTime: a.startTime || "", background: a.background, status: "active" });
    }
    for (const a of completedAgents) {
      if (!agents.some(x => x.id === a.id)) agents.push(a);
    }
    return agents;
  }, [activeAgents, completedAgents]);

  const selected = selectedId === "root" ? null : allAgents.find(a => a.id === selectedId) || null;

  const statusColor = (s: string) => s === "active" ? "bg-green-400" : s === "done" ? "bg-indigo-400" : s === "failed" ? "bg-red-400" : "bg-white/20";
  const statusLabel = (s: string) => s === "active" ? "Running" : s === "done" ? "Complete" : s === "failed" ? "Failed" : "Pending";
  const statusBadge = (s: string) => s === "active" ? "bg-green-500/15 text-green-300" : s === "done" ? "bg-indigo-500/15 text-indigo-300" : s === "failed" ? "bg-red-500/15 text-red-300" : "bg-white/10 text-txt-tertiary";

  const elapsed = (startTime: string) => {
    if (!startTime) return "";
    const ms = Date.now() - new Date(startTime).getTime();
    const s = Math.floor(ms / 1000);
    if (s < 60) return `${s}s`;
    const m = Math.floor(s / 60);
    if (m < 60) return `${m}m${s % 60}s`;
    return `${Math.floor(m / 60)}h${m % 60}m`;
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setSelectedId(null); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  if (!session) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="text-center space-y-2">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="mx-auto text-indigo-400/20">
            <circle cx="12" cy="12" r="3" /><path d="M12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2" />
          </svg>
          <p className="text-[9px] font-sans text-txt-tertiary">No active session</p>
        </div>
      </div>
    );
  }

  if (allAgents.length === 0) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="text-center space-y-3">
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="mx-auto text-indigo-400/15">
            <rect x="4" y="4" width="16" height="16" rx="2" /><rect x="9" y="9" width="6" height="6" /><line x1="9" y1="1" x2="9" y2="4" /><line x1="15" y1="1" x2="15" y2="4" /><line x1="9" y1="20" x2="9" y2="23" /><line x1="15" y1="20" x2="15" y2="23" /><line x1="20" y1="9" x2="23" y2="9" /><line x1="20" y1="14" x2="23" y2="14" /><line x1="1" y1="9" x2="4" y2="9" /><line x1="1" y1="14" x2="4" y2="14" />
          </svg>
          <p className="text-[10px] font-sans font-medium text-txt-secondary">No agents dispatched</p>
          <p className="text-[8px] font-sans text-txt-tertiary">Agents will appear here in real-time</p>
        </div>
      </div>
    );
  }

  const activeCount = allAgents.filter(a => a.status === "active").length;
  const doneCount = allAgents.filter(a => a.status === "done").length;
  const failedCount = allAgents.filter(a => a.status === "failed").length;

  return (
    <div className="flex h-full">
      <div className={`${selectedId ? "w-[55%]" : "w-full"} h-full flex flex-col transition-all duration-300`}>
        <div className="flex items-center gap-4 px-4 py-2.5 border-b border-white/[0.06] shrink-0">
          <span className="text-[8px] font-sans font-bold tracking-[0.2em] uppercase text-txt-tertiary">Agents</span>
          <div className="flex items-center gap-3">
            {activeCount > 0 && <span className="text-[8px] font-mono text-green-300/70">{activeCount} running</span>}
            {doneCount > 0 && <span className="text-[8px] font-mono text-indigo-300/50">{doneCount} done</span>}
            {failedCount > 0 && <span className="text-[8px] font-mono text-red-300/50">{failedCount} failed</span>}
          </div>
          <div className="flex-1" />
          <button onClick={() => setSelectedId(selectedId === "root" ? null : "root")}
            className={`text-[7px] font-sans font-bold tracking-wider uppercase px-2 py-1 rounded-md transition-all ${selectedId === "root" ? "bg-indigo-500/20 text-indigo-300" : "text-txt-tertiary hover:text-txt-secondary hover:bg-white/[0.04]"}`}>
            Session
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-3 py-2 space-y-1.5">
          {allAgents.map(agent => {
            const isSelected = selectedId === agent.id;
            const events = agentEvents[agent.id] || [];
            const label = agent.type || (agent.desc || "agent").slice(0, 30);

            return (
              <button key={agent.id} onClick={() => setSelectedId(isSelected ? null : agent.id)}
                className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-left transition-all ${isSelected ? "bg-indigo-500/10 border border-indigo-400/20" : "hover:bg-white/[0.03] border border-transparent"}`}>
                <div className="relative shrink-0">
                  <div className={`w-2.5 h-2.5 rounded-full ${statusColor(agent.status)}`} />
                  {agent.status === "active" && <div className={`absolute inset-0 w-2.5 h-2.5 rounded-full ${statusColor(agent.status)} animate-ping opacity-50`} />}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-[9px] font-mono font-semibold text-txt-primary truncate">{label}</span>
                    <span className={`text-[6px] font-sans font-bold tracking-wider uppercase px-1.5 py-0.5 rounded-full shrink-0 ${statusBadge(agent.status)}`}>
                      {statusLabel(agent.status)}
                    </span>
                  </div>
                  {agent.desc && agent.desc !== label && (
                    <p className="text-[8px] font-mono text-txt-tertiary truncate mt-0.5">{agent.desc}</p>
                  )}
                </div>
                <div className="text-right shrink-0">
                  <span className="text-[8px] font-mono text-txt-tertiary tabular-nums">{elapsed(agent.startTime)}</span>
                  {events.length > 0 && <p className="text-[7px] font-mono text-txt-tertiary/50">{events.length} events</p>}
                </div>
              </button>
            );
          })}
        </div>
      </div>

      {selectedId && (
        <div className="w-[45%] h-full border-l border-white/[0.08] flex flex-col" style={{ background: "rgba(6,7,12,0.95)" }}>
          <div className="flex items-center justify-between px-4 py-2.5 border-b border-white/[0.06] shrink-0">
            <div className="flex items-center gap-2">
              {selectedId === "root" ? (
                <span className="text-[9px] font-sans font-bold text-indigo-300">Session Overview</span>
              ) : (
                <>
                  <div className={`w-2 h-2 rounded-full ${statusColor(selected?.status || "done")}`} />
                  <span className="text-[9px] font-sans font-bold text-txt-primary">{selected?.type || selected?.desc || "Agent"}</span>
                  <span className={`text-[6px] font-sans font-bold tracking-wider uppercase px-1.5 py-0.5 rounded-full ${statusBadge(selected?.status || "done")}`}>
                    {statusLabel(selected?.status || "done")}
                  </span>
                </>
              )}
            </div>
            <button onClick={() => setSelectedId(null)} className="text-txt-tertiary hover:text-txt-secondary transition-colors p-1 rounded hover:bg-white/[0.04]">
              <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
            </button>
          </div>

          {selectedId === "root" ? (
            <div className="flex-1 overflow-y-auto px-4 py-3 space-y-4">
              <div className="grid grid-cols-2 gap-2">
                {[
                  { label: "Tokens", value: (metrics.tokens.input + metrics.tokens.output) >= 1000 ? `${((metrics.tokens.input + metrics.tokens.output) / 1000).toFixed(1)}k` : String(metrics.tokens.input + metrics.tokens.output), color: "text-indigo-300" },
                  { label: "Cost", value: `$${metrics.cost.toFixed(2)}`, color: "text-emerald-300" },
                  { label: "Agents", value: String(allAgents.length), color: "text-cyan-300" },
                  { label: "Turns", value: String(metrics.turns), color: "text-violet-300" },
                ].map(m => (
                  <div key={m.label} className="rounded-lg border border-white/[0.06] px-3 py-2.5" style={{ background: "rgba(255,255,255,0.02)" }}>
                    <span className="text-[7px] font-sans font-bold tracking-wider uppercase text-txt-tertiary">{m.label}</span>
                    <p className={`text-[12px] font-mono font-bold ${m.color} mt-1`}>{m.value}</p>
                  </div>
                ))}
              </div>
            </div>
          ) : selected ? (
            <div className="flex-1 flex flex-col min-h-0">
              <div className="flex items-center gap-1 px-4 py-2 border-b border-white/[0.06] shrink-0">
                <div className="flex items-center gap-3">
                  <div className="flex items-center gap-1.5">
                    <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-txt-tertiary"><circle cx="12" cy="12" r="10" /><polyline points="12 6 12 12 16 14" /></svg>
                    <span className="text-[9px] font-mono text-txt-secondary">{elapsed(selected.startTime)}</span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-txt-tertiary"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12" /></svg>
                    <span className="text-[9px] font-mono text-txt-secondary">{(agentEvents[selected.id] || []).length} events</span>
                  </div>
                </div>
                <div className="flex-1" />
                {(["activity", "changes"] as const).map(tab => (
                  <button key={tab} onClick={() => setDetailTab(tab)}
                    className={`text-[7px] font-sans font-bold tracking-wider uppercase px-2 py-1 rounded-md transition-all ${detailTab === tab ? "bg-indigo-500/20 text-indigo-300" : "text-txt-tertiary hover:text-txt-secondary hover:bg-white/[0.04]"}`}>
                    {tab}
                  </button>
                ))}
              </div>

              {selected.desc && <p className="text-[9px] font-mono text-txt-secondary/80 leading-relaxed px-4 pt-2">{selected.desc}</p>}

              {detailTab === "activity" && (
                <div className="flex-1 overflow-y-auto px-3 py-2 space-y-2">
                  {selectedCards.length === 0 && <p className="text-[8px] font-mono text-txt-tertiary">Waiting for events...</p>}
                  <AnimatePresence initial={false}>
                    {selectedCards.map(card => (
                      <motion.div key={card.id} variants={cardMotion} initial="initial" animate="animate" exit="exit" transition={cardTr}>
                        <CardRouter card={card} />
                      </motion.div>
                    ))}
                  </AnimatePresence>
                </div>
              )}

              {detailTab === "changes" && (
                <AgentChangesView events={agentEvents[selected.id] || []} />
              )}

              {selected.result && (
                <div className="shrink-0 border-t border-white/[0.06] px-4 py-2">
                  <span className="text-[7px] font-sans font-bold tracking-[0.15em] uppercase text-txt-tertiary">Result</span>
                  <p className="text-[8px] font-mono text-txt-secondary leading-relaxed whitespace-pre-wrap mt-1">{selected.result.slice(0, 500)}{selected.result.length > 500 ? "..." : ""}</p>
                </div>
              )}
            </div>
          ) : null}
        </div>
      )}
    </div>
  );
});

const CursorFlowView = React.memo(function CursorFlowView({ cursorMetrics }: { cursorMetrics: CursorMetrics | null }) {
  const chartScrollRef = useRef<HTMLDivElement>(null);
  const [isChartSticky, setIsChartSticky] = useState(true);

  useEffect(() => {
    if (isChartSticky && chartScrollRef.current) {
      chartScrollRef.current.scrollLeft = chartScrollRef.current.scrollWidth;
    }
  }, [cursorMetrics?.dailyActivity, isChartSticky]);

  if (!cursorMetrics) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <div className="text-center space-y-3">
          <div className="mx-auto w-10 h-10 rounded-full border border-white/[0.07] flex items-center justify-center bg-white/[0.03]">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="text-txt-secondary"><path d="M4 17l6-6-6-6M12 19h8" /></svg>
          </div>
          <p className="text-[11px] font-sans font-medium text-txt-secondary">Cursor not detected</p>
          <p className="text-[9px] font-sans text-txt-tertiary">No AI tracking database found</p>
        </div>
      </div>
    );
  }

  const { totalHashes, composerHashes, humanHashes, aiPercentage, activeModel, trackingSince, dailyActivity, topFiles, commits } = cursorMetrics;
  const maxDaily = Math.max(...dailyActivity.map(d => d.composer + d.human), 1);
  const maxFileCount = Math.max(...topFiles.map(f => f.count), 1);
  const cleanModel = activeModel.replace(/^claude-/, "").replace(/-high-thinking$/, "");

  const extColor = (ext: string) => {
    if (ext === ".tsx") return "rgb(34, 211, 238)";
    if (ext === ".ts") return "rgb(129, 140, 248)";
    if (ext === ".js") return "rgb(251, 191, 36)";
    return "rgb(156, 163, 175)";
  };

  return (
    <div className="flex-1 p-4 space-y-3 overflow-y-auto">
      {/* Summary Cards */}
      <div className="grid grid-cols-4 gap-2">
        <div className="rounded-xl border border-white/[0.07] p-3" style={{ background: "rgba(255,255,255,0.02)" }}>
          <div className="text-[8px] font-sans font-medium text-txt-tertiary uppercase tracking-wider mb-1">AI Contributions</div>
          <div className="text-lg font-mono font-bold text-txt-primary">{totalHashes.toLocaleString()}</div>
          <div className="text-[9px] font-sans text-txt-tertiary mt-0.5">
            <span className="text-cyan-400">{composerHashes}</span> composer &middot; <span className="text-amber-400">{humanHashes}</span> human
          </div>
        </div>

        <div className="rounded-xl border border-white/[0.07] p-3 flex items-center gap-3" style={{ background: "rgba(255,255,255,0.02)" }}>
          <ProgressRing pct={aiPercentage} size={40} stroke={3} />
          <div>
            <div className="text-[8px] font-sans font-medium text-txt-tertiary uppercase tracking-wider mb-0.5">AI vs Human</div>
            <div className="text-sm font-mono font-bold text-txt-primary">{aiPercentage.toFixed(1)}%</div>
          </div>
        </div>

        <div className="rounded-xl border border-white/[0.07] p-3" style={{ background: "rgba(255,255,255,0.02)" }}>
          <div className="text-[8px] font-sans font-medium text-txt-tertiary uppercase tracking-wider mb-1">Active Model</div>
          <div className="text-[11px] font-mono font-bold text-indigo-300 truncate">{cleanModel}</div>
        </div>

        <div className="rounded-xl border border-white/[0.07] p-3" style={{ background: "rgba(255,255,255,0.02)" }}>
          <div className="text-[8px] font-sans font-medium text-txt-tertiary uppercase tracking-wider mb-1">Tracking Since</div>
          <div className="text-[11px] font-mono font-bold text-txt-primary">
            {trackingSince ? new Date(trackingSince).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) : "\u2014"}
          </div>
        </div>
      </div>

      {/* Daily Activity Timeline */}
      <div className="rounded-xl border border-white/[0.07] p-3" style={{ background: "rgba(255,255,255,0.02)" }}>
        <div className="flex items-center justify-between mb-2">
          <div className="text-[8px] font-sans font-medium text-txt-tertiary uppercase tracking-wider">Daily Activity (30d)</div>
          <div className="flex items-center gap-3 text-[8px] font-sans text-txt-tertiary">
            <span><span className="inline-block w-2 h-2 rounded-sm mr-1" style={{ background: "rgb(34, 211, 238)" }} />Composer</span>
            <span><span className="inline-block w-2 h-2 rounded-sm mr-1" style={{ background: "rgb(251, 191, 36)" }} />Human</span>
          </div>
        </div>
        <div className="overflow-x-auto" ref={chartScrollRef}
          onScroll={(e) => {
            const el = e.currentTarget;
            setIsChartSticky(el.scrollWidth - el.scrollLeft - el.clientWidth < 20);
          }}>
          <svg width={Math.max(dailyActivity.length * 20, 200)} height={120} className="block">
            {dailyActivity.map((d, i) => {
              const composerH = (d.composer / maxDaily) * 100;
              const humanH = (d.human / maxDaily) * 100;
              const x = i * 20 + 4;
              return (
                <g key={d.date}>
                  <rect x={x} y={110 - composerH - humanH} width={8} height={humanH} rx={2} fill="rgb(251, 191, 36)" opacity={0.7}>
                    <title>{d.date}: {d.human} human</title>
                  </rect>
                  <rect x={x} y={110 - composerH} width={8} height={composerH} rx={2} fill="rgb(34, 211, 238)" opacity={0.8}>
                    <title>{d.date}: {d.composer} composer</title>
                  </rect>
                </g>
              );
            })}
            <line x1="0" y1="110" x2={dailyActivity.length * 20} y2="110" stroke="rgba(255,255,255,0.06)" strokeWidth="1" />
          </svg>
        </div>
      </div>

      {/* Bottom Row: Top Files + Commit Scores */}
      <div className="grid grid-cols-2 gap-2">
        {/* Top Files */}
        <div className="rounded-xl border border-white/[0.07] p-3" style={{ background: "rgba(255,255,255,0.02)" }}>
          <div className="text-[8px] font-sans font-medium text-txt-tertiary uppercase tracking-wider mb-2">Top Files by AI Contribution</div>
          <div className="space-y-1">
            {topFiles.map((f, i) => (
              <div key={i} className="flex items-center gap-2 text-[9px] font-sans">
                <span className="w-3 h-3 rounded flex items-center justify-center shrink-0" style={{ background: extColor(f.fileExtension) + "22", color: extColor(f.fileExtension) }}>
                  <svg width="8" height="8" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><polyline points="14 2 14 8 20 8" /></svg>
                </span>
                <span className="truncate text-txt-secondary flex-1 min-w-0">{f.fileName}</span>
                <span className="text-[8px] font-mono text-txt-tertiary shrink-0">{f.count}</span>
                <div className="w-16 h-1.5 rounded-full bg-white/[0.04] shrink-0 overflow-hidden">
                  <div className="h-full rounded-full" style={{ width: `${(f.count / maxFileCount) * 100}%`, background: extColor(f.fileExtension), opacity: 0.6 }} />
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Commit Scores */}
        <div className="rounded-xl border border-white/[0.07] p-3" style={{ background: "rgba(255,255,255,0.02)" }}>
          <div className="text-[8px] font-sans font-medium text-txt-tertiary uppercase tracking-wider mb-2">Commit Scores</div>
          <div className="space-y-1 max-h-[240px] overflow-y-auto">
            {commits.length === 0 && <div className="text-[9px] text-txt-tertiary">No scored commits yet</div>}
            {commits.map((c, i) => (
              <div key={i} className="flex items-center gap-2 text-[9px] font-sans py-0.5 border-b border-white/[0.03] last:border-0">
                <span className="truncate text-txt-secondary flex-1 min-w-0">{c.commitMessage.slice(0, 60)}</span>
                <span className="text-[8px] font-mono text-emerald-400/70 shrink-0">+{c.linesAdded}</span>
                <span className="text-[8px] font-mono text-red-400/70 shrink-0">-{c.linesDeleted}</span>
                <span className={`text-[8px] font-mono font-bold shrink-0 px-1 py-0.5 rounded ${
                  c.aiPercentage >= 80 ? "text-red-400 bg-red-500/10" :
                  c.aiPercentage >= 50 ? "text-amber-400 bg-amber-500/10" :
                  "text-emerald-400 bg-emerald-500/10"
                }`}>{c.aiPercentage.toFixed(0)}% AI</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
});

const ClaudeFlowContent = React.memo(function ClaudeFlowContent({ metrics }: { metrics: Metrics }) {
  const usage = metrics.usage;
  const sessionPct = usage?.sessionPercent ?? null;
  const weeklyPct = usage?.weeklyPercent ?? null;
  const resetLabel = usage?.resetLabel || null;
  const elapsed = metrics.elapsed || 1;

  const { costPerHour, cacheHitPct, maxCost } = useMemo(() => {
    const totalIn = metrics.tokens.input + metrics.tokens.cacheRead;
    return {
      costPerHour: elapsed > 0 ? (metrics.cost / (elapsed / 3600000)) : 0,
      cacheHitPct: totalIn > 0 ? Math.round((metrics.tokens.cacheRead / totalIn) * 100) : 0,
      maxCost: Math.max(...(metrics.costHistory || []).map(h => h.cost), 0.0001),
    };
  }, [metrics.tokens, metrics.cost, elapsed, metrics.costHistory]);

  const timelineRef = useRef<HTMLDivElement>(null);
  const stickyRight = useRef(true);

  useEffect(() => {
    const el = timelineRef.current;
    if (!el) return;
    const onScroll = () => {
      stickyRight.current = el.scrollLeft + el.clientWidth >= el.scrollWidth - 4;
    };
    el.addEventListener("scroll", onScroll);
    return () => el.removeEventListener("scroll", onScroll);
  }, []);

  useEffect(() => {
    const el = timelineRef.current;
    if (el && stickyRight.current) {
      el.scrollLeft = el.scrollWidth;
    }
  }, [metrics.costHistory]);

  return (
    <div className="h-full overflow-y-auto p-4 space-y-4">
      {/* Summary Cards */}
      <div className="grid grid-cols-4 gap-3">
        <div className="rounded-xl border border-white/[0.06] p-3 flex flex-col" style={{ background: "var(--glass-card)" }}>
          <span className="text-[7px] font-sans font-bold tracking-[0.2em] uppercase text-txt-tertiary">Total Cost</span>
          <span className="text-[18px] font-mono font-bold text-emerald-400 mt-1">${metrics.cost.toFixed(2)}</span>
          <span className="text-[8px] font-mono text-txt-tertiary mt-0.5">${costPerHour.toFixed(2)}/hr</span>
        </div>
        <div className="rounded-xl border border-white/[0.06] p-3 flex flex-col" style={{ background: "var(--glass-card)" }}>
          <span className="text-[7px] font-sans font-bold tracking-[0.2em] uppercase text-txt-tertiary">Tokens Used</span>
          <div className="flex items-baseline gap-1 mt-1">
            <span className="text-[14px] font-mono font-bold text-indigo-300">{metrics.tokens.input >= 1000 ? `${(metrics.tokens.input / 1000).toFixed(1)}k` : metrics.tokens.input}</span>
            <span className="text-[9px] font-mono text-txt-tertiary">in</span>
            <span className="text-[14px] font-mono font-bold text-cyan-300">{metrics.tokens.output >= 1000 ? `${(metrics.tokens.output / 1000).toFixed(1)}k` : metrics.tokens.output}</span>
            <span className="text-[9px] font-mono text-txt-tertiary">out</span>
          </div>
          <span className="text-[8px] font-mono text-txt-tertiary mt-0.5">{cacheHitPct}% cache hit</span>
        </div>
        <div className="rounded-xl border border-white/[0.06] p-3 flex flex-col items-center" style={{ background: "var(--glass-card)" }}>
          <span className="text-[7px] font-sans font-bold tracking-[0.2em] uppercase text-txt-tertiary mb-1">Session</span>
          {sessionPct !== null ? (
            <>
              <div className="relative">
                <ProgressRing pct={sessionPct} />
                <span className="absolute inset-0 flex items-center justify-center text-[11px] font-mono font-bold text-txt-primary">{sessionPct}%</span>
              </div>
              {resetLabel && <span className="text-[7px] font-mono text-txt-tertiary mt-1">{resetLabel}</span>}
            </>
          ) : (
            <span className="text-[8px] font-mono text-txt-tertiary italic mt-2">Run /usage to sync</span>
          )}
        </div>
        <div className="rounded-xl border border-white/[0.06] p-3 flex flex-col items-center" style={{ background: "var(--glass-card)" }}>
          <span className="text-[7px] font-sans font-bold tracking-[0.2em] uppercase text-txt-tertiary mb-1">Weekly</span>
          {weeklyPct !== null ? (
            <>
              <div className="relative">
                <ProgressRing pct={weeklyPct} />
                <span className="absolute inset-0 flex items-center justify-center text-[11px] font-mono font-bold text-txt-primary">{weeklyPct}%</span>
              </div>
            </>
          ) : (
            <span className="text-[8px] font-mono text-txt-tertiary italic mt-2">Run /usage to sync</span>
          )}
        </div>
      </div>

      {/* Cost Timeline */}
      {(() => {
        const history = metrics.costHistory || [];
        if (history.length === 0) return (
          <div className="rounded-xl border border-white/[0.06] p-4 flex items-center justify-center" style={{ background: "var(--glass-card)", height: 160 }}>
            <span className="text-[9px] font-mono text-txt-tertiary">No cost data yet</span>
          </div>
        );
        const barW = 8, gap = 2, chartH = 120;
        const svgW = history.length * (barW + gap);
        return (
          <div className="rounded-xl border border-white/[0.06] p-3" style={{ background: "var(--glass-card)" }}>
            <span className="text-[7px] font-sans font-bold tracking-[0.2em] uppercase text-txt-tertiary">Cost Per Turn</span>
            <div className="mt-2 overflow-x-auto" ref={timelineRef}>
              <svg width={svgW} height={chartH} className="block">
                {history.map((h, i) => {
                  const barH = Math.max((h.cost / maxCost) * (chartH - 20), 2);
                  const x = i * (barW + gap);
                  const y = chartH - barH;
                  return (
                    <g key={i}>
                      <title>{`${h.model}\n$${h.cost.toFixed(4)}\n${h.inputTokens} in / ${h.outputTokens} out\nCache: ${h.cacheRead} read / ${h.cacheWrite} write\n${new Date(h.timestamp).toLocaleTimeString()}`}</title>
                      <rect x={x} y={y} width={barW} height={barH} rx={2} fill={modelColor(h.model)} opacity={0.8} className="hover:opacity-100 transition-opacity" />
                    </g>
                  );
                })}
              </svg>
            </div>
            <div className="flex items-center gap-3 mt-2">
              {[["opus", "rgb(129, 140, 248)"], ["sonnet", "rgb(34, 211, 238)"], ["haiku", "rgb(251, 191, 36)"]].map(([label, color]) => (
                <div key={label} className="flex items-center gap-1">
                  <div className="w-2 h-2 rounded-sm" style={{ background: color }} />
                  <span className="text-[7px] font-mono text-txt-tertiary">{label}</span>
                </div>
              ))}
            </div>
          </div>
        );
      })()}

      {/* Bottom Panels */}
      <div className="grid grid-cols-2 gap-3">
        {/* Model Breakdown */}
        <div className="rounded-xl border border-white/[0.06] p-3" style={{ background: "var(--glass-card)" }}>
          <span className="text-[7px] font-sans font-bold tracking-[0.2em] uppercase text-txt-tertiary">Model Breakdown</span>
          {(() => {
            const bd = metrics.modelBreakdown || [];
            if (bd.length === 0) return <span className="text-[8px] font-mono text-txt-tertiary block mt-2">No model data</span>;
            const total = bd.reduce((s, m) => s + m.tokens, 0);
            const size = 80, sw = 12, r = (size - sw) / 2, circ = 2 * Math.PI * r;
            let accumulated = 0;
            return (
              <div className="flex items-center gap-4 mt-2">
                <svg width={size} height={size} className="transform -rotate-90 shrink-0">
                  <circle cx={size/2} cy={size/2} r={r} fill="none" stroke="rgba(255,255,255,0.06)" strokeWidth={sw} />
                  {bd.map((m, i) => {
                    const pct = total > 0 ? m.tokens / total : 0;
                    const dashLen = pct * circ;
                    const dashOffset = -accumulated * circ;
                    accumulated += pct;
                    return <circle key={i} cx={size/2} cy={size/2} r={r} fill="none" stroke={modelColor(m.model)} strokeWidth={sw}
                      strokeDasharray={`${dashLen} ${circ - dashLen}`} strokeDashoffset={dashOffset} />;
                  })}
                  <text x={size/2} y={size/2} textAnchor="middle" dominantBaseline="central" className="fill-txt-primary text-[10px] font-mono font-bold" transform={`rotate(90 ${size/2} ${size/2})`}>
                    {total >= 1000 ? `${(total/1000).toFixed(0)}k` : total}
                  </text>
                </svg>
                <div className="space-y-1.5 flex-1 min-w-0">
                  {bd.map(m => (
                    <div key={m.model} className="flex items-center gap-2">
                      <div className="w-2 h-2 rounded-full shrink-0" style={{ background: modelColor(m.model) }} />
                      <span className="text-[8px] font-mono text-txt-secondary truncate flex-1">{m.model}</span>
                      <span className="text-[8px] font-mono text-txt-tertiary tabular-nums">{m.tokens >= 1000 ? `${(m.tokens/1000).toFixed(1)}k` : m.tokens}</span>
                      <span className="text-[8px] font-mono text-txt-tertiary tabular-nums">{m.pct}%</span>
                    </div>
                  ))}
                </div>
              </div>
            );
          })()}
        </div>

        {/* Rate Limit Status */}
        <div className="rounded-xl border border-white/[0.06] p-3" style={{ background: "var(--glass-card)" }}>
          <span className="text-[7px] font-sans font-bold tracking-[0.2em] uppercase text-txt-tertiary">Rate Limits</span>
          <div className="mt-2 space-y-2">
            <div>
              <div className="flex items-center justify-between mb-0.5">
                <span className="text-[8px] font-mono text-txt-secondary">Session</span>
                <span className="text-[8px] font-mono text-txt-tertiary tabular-nums">{sessionPct !== null ? `${sessionPct}%` : "\u2014"}</span>
              </div>
              <div className="h-1.5 rounded-full bg-white/[0.06] overflow-hidden">
                <div className="h-full rounded-full transition-all duration-500" style={{ width: `${sessionPct ?? 0}%`, background: sessionPct !== null ? ringColor(sessionPct) : "transparent" }} />
              </div>
              {resetLabel && <span className="text-[7px] font-mono text-txt-tertiary">{resetLabel}</span>}
            </div>
            <div>
              <div className="flex items-center justify-between mb-0.5">
                <span className="text-[8px] font-mono text-txt-secondary">Weekly</span>
                <span className="text-[8px] font-mono text-txt-tertiary tabular-nums">{weeklyPct !== null ? `${weeklyPct}%` : "\u2014"}</span>
              </div>
              <div className="h-1.5 rounded-full bg-white/[0.06] overflow-hidden">
                <div className="h-full rounded-full transition-all duration-500" style={{ width: `${weeklyPct ?? 0}%`, background: weeklyPct !== null ? ringColor(weeklyPct) : "transparent" }} />
              </div>
            </div>

            {/* Burn rate */}
            {(() => {
              const history = metrics.costHistory || [];
              const tenMinAgo = Date.now() - 10 * 60 * 1000;
              const recent = history.filter(h => new Date(h.timestamp).getTime() > tenMinAgo);
              if (recent.length < 2) return (
                <div className="flex items-center justify-between">
                  <span className="text-[8px] font-mono text-txt-secondary">Burn Rate</span>
                  <span className="text-[8px] font-mono text-txt-tertiary">{"\u2014"}</span>
                </div>
              );
              const windowMs = new Date(recent[recent.length-1].timestamp).getTime() - new Date(recent[0].timestamp).getTime();
              const windowMin = Math.max(windowMs / 60000, 1);
              const totalTok = recent.reduce((s, h) => s + h.inputTokens + h.outputTokens, 0);
              const tokPerMin = Math.round(totalTok / windowMin);
              return (
                <div className="flex items-center justify-between">
                  <span className="text-[8px] font-mono text-txt-secondary">Burn Rate</span>
                  <span className="text-[8px] font-mono text-amber-400 tabular-nums">{tokPerMin >= 1000 ? `${(tokPerMin/1000).toFixed(1)}k` : tokPerMin} tok/min</span>
                </div>
              );
            })()}

            {/* Projected time-to-limit */}
            {(() => {
              if (sessionPct === null || sessionPct >= 100) return null;
              const history = metrics.costHistory || [];
              const tenMinAgo = Date.now() - 10 * 60 * 1000;
              const recent = history.filter(h => new Date(h.timestamp).getTime() > tenMinAgo);
              if (recent.length < 2) return null;
              const windowMs = new Date(recent[recent.length-1].timestamp).getTime() - new Date(recent[0].timestamp).getTime();
              const windowMin = Math.max(windowMs / 60000, 1);
              const totalCostInWindow = recent.reduce((s, h) => s + h.cost, 0);
              const costPerMin = totalCostInWindow / windowMin;
              if (costPerMin <= 0) return null;
              const remainingPct = 100 - sessionPct;
              const estMinutes = Math.round(remainingPct * (metrics.cost / sessionPct) / costPerMin);
              const hrs = Math.floor(estMinutes / 60);
              const mins = estMinutes % 60;
              const label = hrs > 0 ? `~${hrs}h ${mins}m` : `~${mins}m`;
              return (
                <div className="flex items-center justify-between">
                  <span className="text-[8px] font-mono text-txt-secondary">Time to Limit</span>
                  <span className="text-[8px] font-mono text-red-400/80 tabular-nums">{label}</span>
                </div>
              );
            })()}

            {/* Rate limit event log */}
            {(() => {
              const events = (metrics.rateLimitHistory || []).slice(-10).reverse();
              if (events.length === 0) return (
                <div className="mt-1 pt-1 border-t border-white/[0.04]">
                  <span className="text-[7px] font-mono text-txt-tertiary italic">No throttle events</span>
                </div>
              );
              return (
                <div className="mt-1 pt-1 border-t border-white/[0.04] space-y-0.5 max-h-[80px] overflow-y-auto">
                  {events.map((ev, i) => (
                    <div key={i} className="flex items-center justify-between">
                      <span className="text-[7px] font-mono text-red-400/80">{ev.status}</span>
                      <span className="text-[7px] font-mono text-txt-tertiary">{new Date(ev.timestamp).toLocaleTimeString()}</span>
                    </div>
                  ))}
                </div>
              );
            })()}
          </div>
        </div>
      </div>
    </div>
  );
});

const FlowView = React.memo(function FlowView({ metrics }: { metrics: Metrics }) {
  const [provider, setProvider] = useState<"claude" | "cursor">("claude");
  return (
    <div className="h-full flex flex-col overflow-y-auto">
      <div className="shrink-0 flex items-center gap-1 px-4 pt-3 pb-1">
        {(["claude", "cursor"] as const).map(p => (
          <button key={p} onClick={() => setProvider(p)}
            className={`px-3 py-1 rounded-full text-[9px] font-sans font-bold tracking-wider uppercase transition-all duration-200 ${
              provider === p
                ? "bg-indigo-500/20 text-indigo-300 shadow-[0_0_8px_rgba(99,102,241,0.2)]"
                : "text-txt-tertiary hover:text-txt-secondary hover:bg-white/[0.04]"
            }`}>
            {p === "claude" ? "Claude Code" : "Cursor"}
          </button>
        ))}
      </div>
      {provider === "cursor" ? (
        <CursorFlowView cursorMetrics={metrics.cursorMetrics ?? null} />
      ) : (
        <ClaudeFlowContent metrics={metrics} />
      )}
    </div>
  );
});

const HOURLY_CAP = 60;

const Sidebar = React.memo(function Sidebar({ metrics, model, session, onReset, fileTargets, onCycleTarget, snipedCount, hardwareMetrics }: { metrics: Metrics; model: string; session: SessionInfo | null; onReset?: () => void; fileTargets?: Record<string, string>; onCycleTarget?: (file: string) => void; snipedCount?: number; hardwareMetrics?: HwMetrics | null }) {
  const totalTok = metrics.tokens.input + metrics.tokens.output;
  const hourlyPct = Math.min((metrics.hourlyTurns / HOURLY_CAP) * 100, 100);
  const costWarning = metrics.cost >= 5;
  const elapsed = formatDuration(metrics.elapsed);
  const projectName = session?.project?.replace(/^C--Users-[^-]+-/, "").replace(/-/g, "/") || "\u2014";
  const planLabel = (metrics.plan?.subscriptionType || "").replace("max", "Max").replace("pro", "Pro") || "\u2014";
  const breakdown = metrics.modelBreakdown || [];

  const usage = metrics.usage;
  const hasOfficialSession = usage?.sessionPercent !== null && usage?.sessionPercent !== undefined;
  const hasOfficialWeekly = usage?.weeklyPercent !== null && usage?.weeklyPercent !== undefined;
  const sessionPct = hasOfficialSession ? usage!.sessionPercent! : null;
  const weeklyPct = hasOfficialWeekly ? usage!.weeklyPercent! : null;
  const resetLabel = usage?.resetLabel || null;
  const usageSource = usage?.source || "none";

  return (
    <div className="w-full h-full flex flex-col" style={{ background: "var(--sidebar-bg)", backdropFilter: "blur(50px) saturate(160%)" }}>
      <div className="flex-1 overflow-y-auto py-4 px-3 gap-4 flex flex-col">

      <div className="text-center space-y-1.5">
        <div className="flex items-center justify-center gap-1.5">
          <span className="text-[8px] font-sans font-bold tracking-[0.2em] uppercase text-txt-tertiary">{planLabel}</span>
          <span className="text-[7px] font-mono text-txt-tertiary">{"\u2022"}</span>
          <span className="text-[8px] font-mono text-txt-tertiary">{model ? model.replace("claude-", "") : "\u2014"}</span>
        </div>
        <div className="px-2 py-1 rounded-lg bg-indigo-500/20 border border-indigo-400/10">
          <span className="text-[10px] font-mono font-semibold text-indigo-300/90">{model || "\u2014"}</span>
        </div>
      </div>

      <div className="space-y-3">
        <div>
          <div className="flex items-center justify-between mb-1">
            <span className="text-[8px] font-sans font-bold tracking-[0.2em] uppercase text-txt-tertiary">Current Session</span>
            {usageSource !== "none" && <span className="text-[7px] font-mono text-emerald-400/50">{"\u25cf"}</span>}
          </div>
          {hasOfficialSession ? (
            <>
              <ProgressBar value={sessionPct!} detail={`${sessionPct}% used`} />
              {resetLabel && <div className="mt-0.5"><span className="text-[8px] font-mono text-txt-tertiary">{resetLabel}</span></div>}
            </>
          ) : (
            <>
              <ProgressBar value={hourlyPct} detail={`${metrics.turns} turns`} />
              <div className="mt-0.5"><span className="text-[7px] font-mono text-txt-tertiary italic">Run /usage to sync</span></div>
            </>
          )}
        </div>

        {hasOfficialWeekly && (
          <div>
            <div className="flex items-center justify-between mb-1">
              <span className="text-[8px] font-sans font-bold tracking-[0.2em] uppercase text-txt-tertiary">Weekly Limit</span>
            </div>
            <ProgressBar value={weeklyPct!} detail={`${weeklyPct}% used`} />
          </div>
        )}

        {usage?.sonnetPercent != null && usage.sonnetPercent > 0 && (
          <div>
            <div className="flex items-center justify-between mb-1">
              <span className="text-[8px] font-sans font-bold tracking-[0.2em] uppercase text-txt-tertiary">Sonnet Only</span>
            </div>
            <ProgressBar value={usage.sonnetPercent} detail={`${usage.sonnetPercent}% used`} />
          </div>
        )}

        <div>
          <div className="flex items-center justify-between mb-1">
            <span className="text-[8px] font-sans font-bold tracking-[0.2em] uppercase text-txt-tertiary">Hourly Load</span>
          </div>
          <ProgressBar value={hourlyPct} detail={`${metrics.hourlyTurns} turns/hr`} />
        </div>

        {breakdown.length > 0 && (
          <div>
            <span className="text-[8px] font-sans font-bold tracking-[0.2em] uppercase text-txt-tertiary">Model Usage</span>
            <div className="mt-1.5 space-y-1">
              {breakdown.map(mb => (
                <div key={mb.model} className="flex items-center gap-2">
                  <span className="text-[8px] font-mono text-txt-secondary truncate flex-1">{mb.model}</span>
                  <span className="text-[8px] font-mono text-txt-tertiary tabular-nums">{mb.pct}%</span>
                  <div className="w-12 h-1 rounded-full bg-white/[0.06] overflow-hidden">
                    <div className="h-full rounded-full bg-indigo-400/60" style={{ width: `${mb.pct}%` }} />
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      <div className="h-px bg-white/[0.06]" />

      <div className="space-y-3">
        <SideMetric icon={<CpuIcon />} label="Tokens" value={totalTok >= 1000 ? `${(totalTok / 1000).toFixed(1)}k` : String(totalTok)} color="text-indigo-300" />
        <SideMetric icon={<ZapIcon />} label="Velocity" value={`${metrics.rollingVelocity || metrics.velocity} tok/s`} color="text-amber-400" />
        <SideMetric icon={<DollarIcon />} label="Cost" value={`$${metrics.cost.toFixed(2)}`} color="text-emerald-400" pulse={costWarning} />
        <SideMetric icon={<ClockIcon />} label="Elapsed" value={elapsed} color="text-cyan-300" />
        <SideMetric icon={<LayersIcon />} label="Turns" value={String(metrics.turns)} color="text-violet-300" />
        <SideMetric icon={<WrenchIcon />} label="Tools" value={String(metrics.toolCalls)} color="text-orange-300" />
        {(metrics.efficiencyRatio ?? 0) > 0 && (
          <SideMetric icon={<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12" /></svg>} label="Efficiency" value={`${metrics.efficiencyRatio}%`} color="text-cyan-300" />
        )}
      </div>

      {metrics.activeSubagents?.length > 0 && (<>
        <div className="h-px bg-white/[0.06]" />
        <div>
          <span className="text-[8px] font-sans font-semibold tracking-[0.2em] uppercase text-txt-tertiary">Active Agents</span>
          <div className="mt-2 space-y-1.5">
            {metrics.activeSubagents.map(sa => (
              <div key={sa.id} className="flex items-center gap-2 px-2 py-1.5 rounded-md bg-indigo-500/10 border border-indigo-400/10">
                <div className="w-1.5 h-1.5 rounded-full bg-indigo-400 animate-pulse shrink-0" />
                <div className="min-w-0">
                  <span className="text-[8px] font-mono text-indigo-300/80 block">{sa.type}</span>
                  <span className="text-[8px] font-mono text-txt-tertiary block truncate">{sa.desc}</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      </>)}

      <div className="h-px bg-white/[0.06]" />

      <div>
        <div className="flex items-center justify-between">
          <span className="text-[8px] font-sans font-semibold tracking-[0.2em] uppercase text-txt-tertiary">Hot Files</span>
          {(snipedCount || 0) > 0 && <span className="text-[7px] font-mono text-red-400/60">{snipedCount} sniped</span>}
        </div>
        <div className="mt-2 space-y-1">
          {(metrics.topFiles?.length || 0) === 0 && <p className="text-[9px] font-mono text-txt-tertiary">No edits yet</p>}
          {metrics.topFiles?.map((f, i) => {
            const target = fileTargets?.[f.file] || "neutral";
            return (
              <div key={f.file} className="flex items-center gap-1.5 group">
                <button onClick={() => onCycleTarget?.(f.file)} className="shrink-0 w-3.5 h-3.5 flex items-center justify-center rounded-sm transition-colors hover:bg-white/[0.06]" title={target === "neutral" ? "Click: Focus" : target === "focus" ? "Click: Snipe" : "Click: Reset"}>
                  {target === "snipe" && <svg width="7" height="7" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" className="text-red-400/80"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>}
                  {target === "focus" && <svg width="7" height="7" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" className="text-amber-400"><circle cx="12" cy="12" r="10" /><circle cx="12" cy="12" r="3" /></svg>}
                  {target === "neutral" && <svg width="7" height="7" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-txt-tertiary opacity-0 group-hover:opacity-100 transition-opacity"><circle cx="12" cy="12" r="10" /><circle cx="12" cy="12" r="3" /></svg>}
                </button>
                <span className={`text-[9px] font-mono font-bold tabular-nums ${i === 0 ? "text-amber-400/80" : "text-txt-tertiary"}`}>{f.count}x</span>
                <span className={`text-[9px] font-mono truncate ${target === "snipe" ? "text-txt-tertiary/40 line-through" : target === "focus" ? "text-amber-400/90" : "text-txt-secondary"}`}>{f.file}</span>
              </div>
            );
          })}
        </div>
      </div>

      <div className="mt-auto pt-3 border-t border-white/[0.04]">
        <span className="text-[8px] font-sans font-semibold tracking-[0.2em] uppercase text-txt-tertiary">Project</span>
        <p className="text-[9px] font-mono text-txt-secondary mt-1 truncate">{projectName}</p>
        {onReset && (
          <button onClick={onReset} className="mt-2 w-full py-1 rounded-md text-[7px] font-sans font-bold tracking-[0.15em] uppercase text-txt-tertiary hover:text-red-400/80 bg-white/[0.02] hover:bg-red-500/[0.06] border border-white/[0.05] hover:border-red-400/20 transition-colors">
            Reset Session Stats
          </button>
        )}
      </div>
      </div>
      {hardwareMetrics && (
        <div className="shrink-0 border-t border-white/[0.06] px-3 py-3">
          <span className="text-[7px] font-sans font-bold tracking-[0.2em] uppercase text-txt-tertiary mb-2 block">SYSTEM</span>
          <div className="space-y-2">
            <div>
              <div className="flex items-center justify-between mb-0.5">
                <span className="text-[8px] font-mono text-cyan-300/70">CPU</span>
                <span className="text-[8px] font-mono text-txt-secondary tabular-nums">{hardwareMetrics.cpu.percent}%</span>
              </div>
              <div className="h-[4px] rounded-full bg-white/[0.06] overflow-hidden">
                <div className="h-full rounded-full bg-gradient-to-r from-cyan-500 to-cyan-400 gauge-bar" style={{ width: `${hardwareMetrics.cpu.percent}%` }} />
              </div>
            </div>
            <div>
              <div className="flex items-center justify-between mb-0.5">
                <span className="text-[8px] font-mono text-indigo-300/70">MEM</span>
                <span className="text-[8px] font-mono text-txt-secondary tabular-nums">{hardwareMetrics.memory.usedGB}/{hardwareMetrics.memory.totalGB} GB</span>
              </div>
              <div className="h-[4px] rounded-full bg-white/[0.06] overflow-hidden">
                <div className="h-full rounded-full bg-gradient-to-r from-indigo-500 to-indigo-400 gauge-bar" style={{ width: `${hardwareMetrics.memory.percent}%` }} />
              </div>
            </div>
            {hardwareMetrics.gpu?.available && (
              <div>
                <div className="flex items-center justify-between mb-0.5">
                  <span className="text-[8px] font-mono text-emerald-300/70">GPU</span>
                  <span className="text-[8px] font-mono text-txt-secondary tabular-nums">{hardwareMetrics.gpu.utilPercent}%</span>
                </div>
                <div className="h-[4px] rounded-full bg-white/[0.06] overflow-hidden">
                  <div className="h-full rounded-full bg-gradient-to-r from-emerald-500 to-emerald-400 gauge-bar" style={{ width: `${hardwareMetrics.gpu.utilPercent}%` }} />
                </div>
              </div>
            )}
            <div className="text-[7px] font-mono text-txt-tertiary/50">{hardwareMetrics.processes.length} processes</div>
          </div>
        </div>
      )}
    </div>
  );
});



const CommandBar = React.memo(function CommandBar({ onRateLimit }: { onRateLimit?: (data: { status: string; resetsAt: string }) => void }) {
  const [input, setInput] = useState("");
  const [transcript, setTranscript] = useState("");
  const [status, setStatus] = useState<"none" | "working" | "error">("none");
  const [sessionActive, setSessionActive] = useState(false);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const transcriptRef = useRef<HTMLDivElement>(null);

  type StreamAPI = {
    sendStreamPrompt: (t: string) => void;
    cancelStream: () => void;
    endStreamSession: () => void;
    onStreamEvent: (cb: (d: { type: string; content?: { type: string; text?: string; name?: string; input?: Record<string, unknown> }[]; tokens?: { input: number; output: number; cacheRead: number; cacheCreation: number }; model?: string; totalCost?: number; durationMs?: number; isError?: boolean; result?: string; exitCode?: number; status?: string; resetsAt?: string }) => void) => void;
    removeStreamEvent: () => void;
    onFocusInput: (cb: () => void) => void;
    removeFocusInput: () => void;
  };

  const getApi = () => (window as unknown as Record<string, StreamAPI>).electronAPI;

  useEffect(() => {
    const api = getApi();
    if (!api) return;

    api.onFocusInput(() => { inputRef.current?.focus(); });

    api.onStreamEvent((msg) => {
      if (msg.type === "init") {
        setSessionActive(true);
      } else if (msg.type === "assistant" && msg.content) {
        setStatus("working");
        for (const block of msg.content) {
          if (block.type === "text" && block.text) {
            setTranscript(prev => prev + block.text);
          }
          if (block.type === "tool_use") {
            setTranscript(prev => prev + `\n${formatTranscriptTool(block.name || "Tool", (block.input || {}) as Record<string, unknown>)}\n`);
          }
        }
      } else if (msg.type === "result") {
        if (msg.isError) {
          setStatus("error");
          setTranscript(prev => prev + `\nError: ${msg.result || "Unknown error"}\n`);
        }
        setSessionActive(true);
      } else if (msg.type === "done") {
        setStatus("none");
        inputRef.current?.focus();
      } else if (msg.type === "rateLimit") {
        onRateLimit?.({ status: msg.status || "unknown", resetsAt: msg.resetsAt || "" });
      }
    });

    return () => {
      api.removeStreamEvent();
      api.removeFocusInput();
    };
  }, []);

  useEffect(() => {
    if (transcriptRef.current) {
      transcriptRef.current.scrollTop = transcriptRef.current.scrollHeight;
    }
  }, [transcript]);

  const resizeTextarea = useCallback(() => {
    const el = inputRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = Math.min(el.scrollHeight, 300) + "px";
  }, []);

  useEffect(() => { resizeTextarea(); }, [input, resizeTextarea]);

  const send = () => {
    const text = input.trim();
    if (!text || status === "working") return;
    const api = getApi();
    if (!api) return;
    setTranscript(prev => prev + (prev ? "\n" : "") + "> " + text + "\n");
    setStatus("working");
    api.sendStreamPrompt(text);
    setInput("");
    if (inputRef.current) inputRef.current.style.height = "auto";
  };

  const cancel = () => {
    const api = getApi();
    if (!api) return;
    api.cancelStream();
  };

  const endSession = () => {
    const api = getApi();
    if (!api) return;
    api.endStreamSession();
    setTranscript("");
    setSessionActive(false);
  };

  const isWorking = status === "working";

  return (
    <div className={`no-drag shrink-0 border-t border-white/[0.08] transition-all duration-300 ${isWorking ? "cmd-thinking" : ""}`} style={{ background: "rgba(0, 0, 0, 0.40)", backdropFilter: "blur(24px) saturate(150%)" }}>
      {transcript && (
        <div ref={transcriptRef} className="px-3 pt-2 pb-1 max-h-[150px] overflow-y-auto">
          <pre className="text-[9px] font-mono text-indigo-200/70 leading-relaxed whitespace-pre-wrap break-words">{transcript}</pre>
        </div>
      )}
      <div className="flex items-end gap-2 px-3 py-2">
        <div className="flex items-center gap-1.5 shrink-0 self-center">
          <div className={`w-2 h-2 rounded-full ${isWorking ? "bg-cyan-400 animate-pulse" : status === "error" ? "bg-red-400" : sessionActive ? "bg-green-400" : "bg-white/20"}`} />
          <span className="text-[7px] font-mono text-txt-tertiary w-[40px]">{isWorking ? "Stream" : sessionActive ? "Ready" : "Idle"}</span>
        </div>
        <div className="relative flex-1">
          <textarea
            ref={inputRef}
            rows={1}
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={e => {
              if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); }
              if (e.key === "Escape") { if (isWorking) cancel(); else inputRef.current?.blur(); }
            }}
            placeholder={isWorking ? "Streaming..." : "Send a prompt...   Ctrl+K"}
            className="w-full px-3 py-1.5 rounded-lg text-[10px] font-mono text-txt-secondary placeholder:text-txt-tertiary outline-none transition-all focus:ring-1 focus:ring-indigo-500/30 resize-none overflow-hidden"
            style={{ background: "rgba(255, 255, 255, 0.04)", border: "1px solid rgba(255, 255, 255, 0.06)" }}
          />
          {isWorking && (
            <div className="absolute right-2.5 bottom-2">
              <div className="w-3 h-3 rounded-full border border-cyan-400/50 border-t-cyan-400 animate-spin" />
            </div>
          )}
        </div>
        {isWorking ? (
          <button onClick={cancel} className="px-3 py-1.5 rounded-lg transition-all"
            style={{ background: "rgba(239, 68, 68, 0.20)", border: "1px solid rgba(239, 68, 68, 0.15)", color: "rgba(252, 165, 165, 0.9)" }}>
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
              <rect x="3" y="3" width="18" height="18" rx="2" />
            </svg>
          </button>
        ) : (
          <button onClick={send} disabled={!input.trim()}
            className="px-3 py-1.5 rounded-lg transition-all disabled:opacity-30"
            style={{ background: "rgba(99, 102, 241, 0.20)", border: "1px solid rgba(99, 102, 241, 0.15)", color: "rgba(165, 180, 252, 0.9)" }}>
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
              <line x1="22" y1="2" x2="11" y2="13" /><polygon points="22 2 15 22 11 13 2 9 22 2" />
            </svg>
          </button>
        )}
        {sessionActive && (
          <button onClick={endSession} title="End session"
            className="px-2 py-1.5 rounded-lg transition-all text-txt-tertiary/50 hover:text-red-400/80"
            style={{ background: "transparent", border: "1px solid rgba(255, 255, 255, 0.04)" }}>
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <path d="M18.36 6.64A9 9 0 1 1 5.64 5.64" /><line x1="12" y1="2" x2="12" y2="12" />
            </svg>
          </button>
        )}
      </div>
    </div>
  );
});

function MiniSparkline({ data, color, width = 80, height = 20 }: { data: number[]; color: string; width?: number; height?: number }) {
  if (data.length < 2) return null;
  const max = 100;
  const points = data.map((v, i) => `${(i / (data.length - 1)) * width},${height - (v / max) * height}`).join(" ");
  return (
    <svg width={width} height={height} className="opacity-60">
      <polyline points={points} fill="none" stroke={color} strokeWidth="1.5" strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  );
}

function ProcessTree({ processes }: { processes: { pid: number; name: string; cpuPercent: number; memoryMB: number; parentPid: number }[] }) {
  const [collapsed, setCollapsed] = useState<Set<number>>(new Set());
  if (processes.length === 0) return <p className="text-[9px] font-mono text-txt-tertiary">No processes tracked</p>;

  const rootPids = new Set(processes.map(p => p.pid));
  const roots = processes.filter(p => !rootPids.has(p.parentPid));
  const childMap = new Map<number, typeof processes>();
  for (const p of processes) {
    if (!childMap.has(p.parentPid)) childMap.set(p.parentPid, []);
    childMap.get(p.parentPid)!.push(p);
  }

  function renderNode(proc: typeof processes[0], depth: number): React.ReactNode {
    const children = childMap.get(proc.pid) || [];
    const hasChildren = children.length > 0;
    const isCollapsed = collapsed.has(proc.pid);
    return (
      <div key={proc.pid}>
        <div className="flex items-center gap-2 py-0.5 hover:bg-white/[0.03] rounded px-1" style={{ paddingLeft: depth * 16 }}>
          {hasChildren ? (
            <button onClick={() => setCollapsed(prev => { const s = new Set(prev); if (s.has(proc.pid)) s.delete(proc.pid); else s.add(proc.pid); return s; })} className="text-txt-tertiary w-3 text-[10px]">
              {isCollapsed ? "\u25B6" : "\u25BC"}
            </button>
          ) : <span className="w-3" />}
          <span className="text-[8px] font-mono text-txt-tertiary tabular-nums w-12">{proc.pid}</span>
          <span className="text-[9px] font-mono text-txt-secondary flex-1 truncate">{proc.name}</span>
          <span className="text-[8px] font-mono text-cyan-300/60 tabular-nums w-10 text-right">{proc.cpuPercent}%</span>
          <span className="text-[8px] font-mono text-indigo-300/60 tabular-nums w-14 text-right">{proc.memoryMB} MB</span>
        </div>
        {hasChildren && !isCollapsed && children.map(c => renderNode(c, depth + 1))}
      </div>
    );
  }

  return <div>{(roots.length > 0 ? roots : processes.slice(0, 1)).map(r => renderNode(r, 0))}</div>;
}

function HistoryChart({ history, width = 500, height = 100 }: { history: { cpu: { percent: number }; memory: { percent: number } }[]; width?: number; height?: number }) {
  if (history.length < 2) return null;
  const cpuPoints = history.map((h, i) => `${(i / (history.length - 1)) * width},${height - (h.cpu.percent / 100) * height}`).join(" ");
  const memPoints = history.map((h, i) => `${(i / (history.length - 1)) * width},${height - (h.memory.percent / 100) * height}`).join(" ");
  return (
    <svg width="100%" viewBox={`0 0 ${width} ${height + 20}`} preserveAspectRatio="none" className="w-full">
      <line x1="0" y1={height} x2={width} y2={height} stroke="rgba(255,255,255,0.06)" strokeWidth="0.5" />
      <line x1="0" y1={height * 0.5} x2={width} y2={height * 0.5} stroke="rgba(255,255,255,0.03)" strokeWidth="0.5" strokeDasharray="4 4" />
      <polyline points={memPoints} fill="none" stroke="rgba(129,140,248,0.5)" strokeWidth="1.5" strokeLinejoin="round" />
      <polyline points={cpuPoints} fill="none" stroke="rgba(34,211,238,0.7)" strokeWidth="1.5" strokeLinejoin="round" />
      <text x="4" y={height + 14} fill="rgba(255,255,255,0.2)" fontSize="8" fontFamily="monospace">5m ago</text>
      <text x={width - 20} y={height + 14} fill="rgba(255,255,255,0.2)" fontSize="8" fontFamily="monospace">now</text>
    </svg>
  );
}

const MonitorView = React.memo(function MonitorView({ current, history }: { current: HwMetrics | null; history: HwMetrics[] }) {
  const { cpuSparkline, memSparkline, cpuPeak, memPeak } = useMemo(() => {
    const cpuH = history.map(h => h.cpu.percent);
    const memH = history.map(h => h.memory.percent);
    return {
      cpuSparkline: cpuH.slice(-60),
      memSparkline: memH.slice(-60),
      cpuPeak: cpuH.length > 0 ? Math.max(...cpuH) : 0,
      memPeak: memH.length > 0 ? Math.max(...memH) : 0,
    };
  }, [history]);

  if (!current) return (
    <div className="flex items-center justify-center h-full">
      <p className="text-[11px] font-sans text-txt-tertiary">Waiting for hardware data...</p>
    </div>
  );

  const { cpu, memory, gpu, processes } = current;

  return (
    <div className="p-4 space-y-4 overflow-y-auto h-full">
      <div>
        <span className="text-[8px] font-sans font-bold tracking-[0.2em] uppercase text-txt-tertiary">System Overview</span>
        <div className={`grid gap-3 mt-2 ${gpu?.available ? "grid-cols-3" : "grid-cols-2"}`}>
          <div className="rounded-xl border border-white/[0.08] p-3" style={{ background: "rgba(255,255,255,0.02)" }}>
            <div className="flex items-center justify-between mb-2">
              <span className="text-[9px] font-sans font-bold text-cyan-300">CPU</span>
              <span className="text-[7px] font-mono text-txt-tertiary">peak {cpuPeak}%</span>
            </div>
            <span className="text-[20px] font-mono font-bold text-cyan-300 tabular-nums">{cpu.percent}%</span>
            <div className="mt-2">
              <MiniSparkline data={cpuSparkline} color="rgb(34,211,238)" />
            </div>
          </div>
          <div className="rounded-xl border border-white/[0.08] p-3" style={{ background: "rgba(255,255,255,0.02)" }}>
            <div className="flex items-center justify-between mb-2">
              <span className="text-[9px] font-sans font-bold text-indigo-300">Memory</span>
              <span className="text-[7px] font-mono text-txt-tertiary">peak {memPeak}%</span>
            </div>
            <span className="text-[20px] font-mono font-bold text-indigo-300 tabular-nums">{memory.percent}%</span>
            <div className="text-[8px] font-mono text-txt-tertiary mt-0.5">{memory.usedGB} / {memory.totalGB} GB</div>
            <div className="mt-2">
              <MiniSparkline data={memSparkline} color="rgb(129,140,248)" />
            </div>
          </div>
          {gpu?.available && (
            <div className="rounded-xl border border-white/[0.08] p-3" style={{ background: "rgba(255,255,255,0.02)" }}>
              <div className="flex items-center justify-between mb-2">
                <span className="text-[9px] font-sans font-bold text-emerald-300">GPU</span>
                <span className="text-[7px] font-mono text-txt-tertiary">{gpu.tempC}&deg;C</span>
              </div>
              <span className="text-[20px] font-mono font-bold text-emerald-300 tabular-nums">{gpu.utilPercent}%</span>
              <div className="text-[8px] font-mono text-txt-tertiary mt-0.5">{gpu.name}</div>
              <div className="mt-2">
                <div className="flex items-center justify-between mb-0.5">
                  <span className="text-[7px] font-mono text-txt-tertiary">VRAM</span>
                  <span className="text-[7px] font-mono text-txt-tertiary">{gpu.vramUsedMB}/{gpu.vramTotalMB} MB</span>
                </div>
                <div className="h-[4px] rounded-full bg-white/[0.06] overflow-hidden">
                  <div className="h-full rounded-full bg-gradient-to-r from-emerald-500 to-emerald-400" style={{ width: `${gpu.vramTotalMB ? (gpu.vramUsedMB! / gpu.vramTotalMB) * 100 : 0}%` }} />
                </div>
              </div>
            </div>
          )}
        </div>
      </div>

      <div>
        <span className="text-[8px] font-sans font-bold tracking-[0.2em] uppercase text-txt-tertiary">Process Tree</span>
        <div className="mt-2 rounded-xl border border-white/[0.08] p-3" style={{ background: "rgba(255,255,255,0.02)" }}>
          <div className="flex items-center gap-2 pb-1.5 mb-1.5 border-b border-white/[0.06] text-[7px] font-sans font-bold tracking-wider uppercase text-txt-tertiary">
            <span className="w-3" />
            <span className="w-12">PID</span>
            <span className="flex-1">Name</span>
            <span className="w-10 text-right">CPU</span>
            <span className="w-14 text-right">Memory</span>
          </div>
          <ProcessTree processes={processes} />
        </div>
      </div>

      <div>
        <div className="flex items-center justify-between">
          <span className="text-[8px] font-sans font-bold tracking-[0.2em] uppercase text-txt-tertiary">History</span>
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-1"><div className="w-2 h-0.5 rounded bg-cyan-400/70" /><span className="text-[7px] font-mono text-txt-tertiary">CPU</span></div>
            <div className="flex items-center gap-1"><div className="w-2 h-0.5 rounded bg-indigo-400/50" /><span className="text-[7px] font-mono text-txt-tertiary">MEM</span></div>
          </div>
        </div>
        <div className="mt-2 rounded-xl border border-white/[0.08] p-3" style={{ background: "rgba(255,255,255,0.02)" }}>
          <HistoryChart history={history} />
        </div>
      </div>
    </div>
  );
});

const StatusBar = React.memo(function StatusBar({ connected, onOpenSettings, activeView, onViewChange, updateStatus }: { connected: boolean; onOpenSettings: () => void; activeView: string; onViewChange: (v: string) => void; updateStatus: string }) {
  const eApi = () => (window as unknown as Record<string, Record<string, (...args: unknown[]) => void>>).electronAPI;
  const winMinimize = () => { eApi()?.minimize(); };
  const winToggleMax = () => { eApi()?.toggleMaximize(); };
  const winClose = () => { eApi()?.close(); };
  const installUpdate = () => { eApi()?.installUpdate(); };

  return (
    <div className="drag-region flex items-center px-4 py-0 border-b border-white/[0.05] shrink-0"
         style={{ background: "var(--header-bg)", backdropFilter: "blur(40px) saturate(160%)" }}>
      <div className="flex items-center gap-2 no-drag py-1.5">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="./logo.png" alt="ModelScope" className="h-6 w-6 rounded-md" style={{ filter: "drop-shadow(0 0 8px rgba(99, 102, 241, 0.4))" }} />
        <div className="flex items-center gap-0.5">
          <span className="text-[10px] font-sans font-black text-txt-primary tracking-tight">Model</span>
          <span className="text-[10px] font-sans font-light text-indigo-300/80 tracking-tight">Scope</span>
        </div>
        <div className={`w-[5px] h-[5px] rounded-full transition-all duration-500 ${connected ? "bg-indigo-400 animate-live-pulse" : "bg-white/15"}`} />
        <span className="text-[7px] font-mono text-txt-tertiary">v1.0</span>
        {updateStatus === "ready" && (
          <button onClick={installUpdate} className="no-drag ml-1 px-1.5 py-0.5 rounded-full bg-indigo-500/25 border border-indigo-400/30 text-[7px] font-mono text-indigo-300 hover:bg-indigo-500/40 transition-all animate-live-pulse" title="Click to install update and restart">
            UPDATE READY
          </button>
        )}
      </div>
      <div className="flex-1 flex justify-center">
        <div className="no-drag flex items-center gap-0.5 px-1.5 py-0.5 rounded-full border border-white/[0.08]" style={{ background: "rgba(255,255,255,0.04)", backdropFilter: "blur(12px)" }}>
          {[
            { id: "feed", label: "FEED", enabled: true },
            { id: "agents", label: "AGENTS", enabled: true },
            { id: "flow", label: "FLOW", enabled: true },
            { id: "monitor", label: "MONITOR", enabled: true },
          ].map(btn => (
            <button key={btn.id} onClick={() => btn.enabled && onViewChange(btn.id)}
              className={`px-2.5 py-1 rounded-full text-[7px] font-sans font-bold tracking-[0.2em] uppercase transition-all duration-200 ${
                activeView === btn.id
                  ? "bg-indigo-500/25 text-white shadow-[0_2px_8px_rgba(99,102,241,0.3)]"
                  : btn.enabled
                  ? "text-txt-tertiary hover:text-txt-secondary hover:bg-white/[0.06]"
                  : "text-txt-tertiary/30 cursor-not-allowed"
              }`}
              disabled={!btn.enabled}>
              {btn.label}
            </button>
          ))}
        </div>
      </div>
      <div className="flex items-center no-drag h-full">
        <button onClick={onOpenSettings} className="w-8 h-8 flex items-center justify-center text-white/30 hover:text-indigo-400 transition-all group" title="Settings">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" className="transition-transform duration-300 group-hover:rotate-90 group-hover:drop-shadow-[0_0_4px_rgba(129,140,248,0.5)]">
            <circle cx="12" cy="12" r="3" /><path d="M12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42" />
          </svg>
        </button>
        <div className="w-px h-4 bg-white/[0.06] mx-0.5" />
        <button onClick={winMinimize} className="w-10 h-8 flex items-center justify-center text-white/30 hover:text-white/80 hover:bg-white/[0.06] transition-colors" title="Minimize">
          <svg width="10" height="1" viewBox="0 0 10 1"><line x1="0" y1="0.5" x2="10" y2="0.5" stroke="currentColor" strokeWidth="1" /></svg>
        </button>
        <button onClick={winToggleMax} className="w-10 h-8 flex items-center justify-center text-white/30 hover:text-white/80 hover:bg-white/[0.06] transition-colors" title="Maximize">
          <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1"><rect x="0.5" y="0.5" width="9" height="9" /></svg>
        </button>
        <button onClick={winClose} className="w-10 h-8 flex items-center justify-center text-white/30 hover:text-red-400 hover:bg-red-500/15 transition-colors rounded-tr-2xl" title="Close">
          <svg width="10" height="10" viewBox="0 0 10 10" stroke="currentColor" strokeWidth="1.2"><line x1="1" y1="1" x2="9" y2="9" /><line x1="9" y1="1" x2="1" y2="9" /></svg>
        </button>
      </div>
    </div>
  );
});



const MAX_CARDS = 60;
function createDefaultMetrics(): Metrics {
  return { tokens: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, cost: 0, turns: 0, toolCalls: 0, elapsed: 0, velocity: 0, startTime: Date.now(), hourlyTurns: 0, topFiles: [], errorCount: 0, activeSubagents: [], plan: undefined, modelBreakdown: [], usage: undefined };
}

function useHardwareMetrics() {
  const [hardwareMetrics, setHardwareMetrics] = useState<HwMetrics | null>(null);
  const [hardwareHistory, setHardwareHistory] = useState<HwMetrics[]>([]);

  useEffect(() => {
    const hwApi = (window as unknown as Record<string, Record<string, (...args: unknown[]) => void>>).electronAPI;
    hwApi?.onHardwareMetrics?.((data: unknown) => {
      const d = data as HwMetrics;
      setHardwareMetrics(d);
      setHardwareHistory(prev => {
        const next = [...prev, d];
        return next.length > 120 ? next.slice(-120) : next;
      });
    });
    return () => { hwApi?.removeHardwareMetrics?.(); };
  }, []);

  return { hardwareMetrics, hardwareHistory };
}

function useAgentState(socketRef: React.RefObject<Socket | null>) {
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
