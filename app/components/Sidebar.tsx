"use client";
import React from "react";
import type { Metrics, SessionInfo, ProjectInfo, HwMetrics } from "./types";
import { ProgressBar, SideMetric, CpuIcon, ZapIcon, DollarIcon, ClockIcon, LayersIcon, WrenchIcon, formatDuration } from "./shared";

export function SessionPanel({ projects, activeProjectId, onSelect }: { projects: ProjectInfo[]; activeProjectId: string | null; onSelect: (id: string) => void }) {
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

export const Sidebar = React.memo(function Sidebar({ metrics, model, session, onReset, fileTargets, onCycleTarget, snipedCount, hardwareMetrics }: { metrics: Metrics; model: string; session: SessionInfo | null; onReset?: () => void; fileTargets?: Record<string, string>; onCycleTarget?: (file: string) => void; snipedCount?: number; hardwareMetrics?: HwMetrics | null }) {
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
