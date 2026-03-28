"use client";
import React from "react";

export const StatusBar = React.memo(function StatusBar({ connected, onOpenSettings, activeView, onViewChange, updateStatus }: { connected: boolean; onOpenSettings: () => void; activeView: string; onViewChange: (v: string) => void; updateStatus: string }) {
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
