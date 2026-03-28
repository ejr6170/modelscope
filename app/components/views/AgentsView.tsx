"use client";
import React, { useState, useEffect, useMemo } from "react";
import { motion, AnimatePresence } from "framer-motion";
import type { SessionEvent, Metrics, AgentNode, FeedCard } from "../types";
import { CodeLines, DiffLines } from "../cards/CodeLines";
import { eventToCards, CardRouter, cardMotion, cardTr, Timestamp } from "../cards/CardRouter";

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

export const AgentsView = React.memo(function AgentsView({ activeAgents, completedAgents, agentEvents, session, metrics }: {
  activeAgents: { id: string; type?: string; desc?: string; startTime?: string; background?: boolean }[];
  completedAgents: AgentNode[];
  agentEvents: Record<string, SessionEvent[]>;
  session: { sessionId: string; project: string; startedAt: string } | null;
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

export { AgentChangesView };
