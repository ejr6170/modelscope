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
