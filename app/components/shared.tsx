"use client";
import React from "react";
import { motion } from "framer-motion";

export function ringColor(pct: number): string {
  if (pct >= 80) return "rgb(248, 113, 113)";
  if (pct >= 60) return "rgb(251, 191, 36)";
  return "rgb(52, 211, 153)";
}

export function modelColor(model: string): string {
  if (model.includes("opus")) return "rgb(129, 140, 248)";
  if (model.includes("haiku")) return "rgb(251, 191, 36)";
  return "rgb(34, 211, 238)";
}

export function ProgressRing({ pct, size = 48, stroke = 4 }: { pct: number; size?: number; stroke?: number }) {
  const r = (size - stroke) / 2;
  const circ = 2 * Math.PI * r;
  const offset = circ - (Math.min(pct, 100) / 100) * circ;
  const color = ringColor(pct);
  return (
    <svg width={size} height={size} className="transform -rotate-90">
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="rgba(255,255,255,0.06)" strokeWidth={stroke} />
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={color} strokeWidth={stroke}
        strokeDasharray={circ} strokeDashoffset={offset} strokeLinecap="round" className="transition-all duration-500" />
    </svg>
  );
}

export function shortPath(f?: string): string { if (!f) return ""; const p = f.replace(/\\/g, "/").split("/"); return p.length > 2 ? p.slice(-2).join("/") : f; }

export function formatDuration(ms: number): string { const s = Math.floor(ms / 1000), m = Math.floor(s / 60), h = Math.floor(m / 60); if (h > 0) return `${h}h${String(m % 60).padStart(2, "0")}m`; if (m > 0) return `${m}m${String(s % 60).padStart(2, "0")}s`; return `${s}s`; }

export function ProgressBar({ value, detail }: { value: number; detail: string }) {
  const color = value >= 80 ? "from-amber-500 to-orange-500" : value >= 50 ? "from-blue-400 to-cyan-400" : "from-blue-500 to-cyan-500";
  const glow = value >= 80 ? "shadow-[0_0_8px_rgba(251,191,36,0.4)]" : "shadow-[0_0_6px_rgba(59,130,246,0.3)]";
  return (<div>
    <div className="h-[5px] rounded-full bg-white/[0.06] overflow-hidden">
      <motion.div className={`h-full rounded-full bg-gradient-to-r ${color} ${glow}`} initial={{ width: 0 }} animate={{ width: `${value}%` }} transition={{ duration: 0.6, ease: "easeOut" }} />
    </div>
    <div className="flex items-center justify-end mt-0.5">
      <span className="text-[8px] font-mono text-txt-tertiary tabular-nums">{detail}</span>
    </div>
  </div>);
}

export function SideMetric({ icon, label, value, color, pulse }: { icon: React.ReactNode; label: string; value: string; color: string; pulse?: boolean }) {
  return (<div className={`flex items-center gap-2.5 ${pulse ? "animate-pulse" : ""}`}><span className={`${color} opacity-50 shrink-0`}>{icon}</span><div className="flex-1 min-w-0"><span className="text-[8px] font-sans font-semibold tracking-[0.18em] uppercase text-txt-tertiary block leading-none">{label}</span><span className={`text-[12px] font-mono font-bold leading-tight tabular-nums ${color} block mt-0.5`}>{value}</span></div></div>);
}

export function CpuIcon() { return <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><rect x="4" y="4" width="16" height="16" rx="2" /><rect x="9" y="9" width="6" height="6" /><line x1="9" y1="1" x2="9" y2="4" /><line x1="15" y1="1" x2="15" y2="4" /><line x1="9" y1="20" x2="9" y2="23" /><line x1="15" y1="20" x2="15" y2="23" /><line x1="20" y1="9" x2="23" y2="9" /><line x1="20" y1="14" x2="23" y2="14" /><line x1="1" y1="9" x2="4" y2="9" /><line x1="1" y1="14" x2="4" y2="14" /></svg>; }
export function ZapIcon() { return <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" /></svg>; }
export function DollarIcon() { return <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><line x1="12" y1="1" x2="12" y2="23" /><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6" /></svg>; }
export function ClockIcon() { return <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><circle cx="12" cy="12" r="10" /><polyline points="12 6 12 12 16 14" /></svg>; }
export function LayersIcon() { return <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><polygon points="12 2 2 7 12 12 22 7 12 2" /><polyline points="2 17 12 22 22 17" /><polyline points="2 12 12 17 22 12" /></svg>; }
export function WrenchIcon() { return <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z" /></svg>; }
