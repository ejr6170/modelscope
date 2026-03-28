"use client";
import React, { useState, useEffect, useRef, useMemo } from "react";
import type { Metrics, CursorMetrics } from "../types";
import { ringColor, modelColor, ProgressRing } from "../shared";

export const CursorFlowView = React.memo(function CursorFlowView({ cursorMetrics }: { cursorMetrics: CursorMetrics | null }) {
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

export const ClaudeFlowContent = React.memo(function ClaudeFlowContent({ metrics }: { metrics: Metrics }) {
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
  const [hoveredBar, setHoveredBar] = useState<{
    x: number; y: number; cost: number; model: string;
    inputTokens: number; outputTokens: number;
    cacheRead: number; cacheWrite: number; timestamp: string;
  } | null>(null);

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
            <div className="mt-2 overflow-x-auto relative" ref={timelineRef}>
              <svg width={svgW} height={chartH} className="block">
                {history.map((h, i) => {
                  const barH = Math.max((h.cost / maxCost) * (chartH - 20), 2);
                  const x = i * (barW + gap);
                  const y = chartH - barH;
                  return (
                    <rect key={i} x={x} y={y} width={barW} height={barH} rx={2}
                      fill={modelColor(h.model)} opacity={hoveredBar?.x === x ? 1 : 0.8}
                      className="transition-opacity cursor-pointer"
                      onMouseEnter={() => setHoveredBar({ x, y, cost: h.cost, model: h.model, inputTokens: h.inputTokens, outputTokens: h.outputTokens, cacheRead: h.cacheRead, cacheWrite: h.cacheWrite, timestamp: h.timestamp })}
                      onMouseLeave={() => setHoveredBar(null)}
                    />
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

export const FlowView = React.memo(function FlowView({ metrics }: { metrics: Metrics }) {
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
