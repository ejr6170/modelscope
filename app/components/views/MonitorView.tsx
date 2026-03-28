"use client";
import React, { useState, useMemo } from "react";
import type { HwMetrics } from "../types";

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

export const MonitorView = React.memo(function MonitorView({ current, history }: { current: HwMetrics | null; history: HwMetrics[] }) {
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
