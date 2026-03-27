"use client";
import React, { useState, useEffect, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import type { HudSettings } from "./types";

export const DEFAULT_SETTINGS: HudSettings = {
  glassOpacity: 0.82,
  blurIntensity: "high",
  sidebarShadows: true,
  hotspotsEnabled: true,
  rationaleAutoExpand: false,
  tooltipDelay: 150,
  sessionBudget: 0,
  inputRate: 15,
  outputRate: 75,
  alwaysOnTop: true,
  simpleHotspots: false,
  autoSnipeLargeFiles: false,
};

export function useSettings(): [HudSettings, (patch: Partial<HudSettings>) => void, () => void] {
  const [settings, setSettings] = useState<HudSettings>(DEFAULT_SETTINGS);

  useEffect(() => {
    try {
      const saved = localStorage.getItem("modelscope-settings");
      if (saved) setSettings(prev => ({ ...prev, ...JSON.parse(saved) }));
    } catch {}
  }, []);

  const update = useCallback((patch: Partial<HudSettings>) => {
    setSettings(prev => {
      const next = { ...prev, ...patch };
      try { localStorage.setItem("modelscope-settings", JSON.stringify(next)); } catch {}
      return next;
    });
  }, []);

  const reset = useCallback(() => {
    setSettings(DEFAULT_SETTINGS);
    try { localStorage.removeItem("modelscope-settings"); } catch {}
  }, []);

  return [settings, update, reset];
}

export function SettingsModal({ settings, onUpdate, onReset, onClose }: {
  settings: HudSettings; onUpdate: (p: Partial<HudSettings>) => void; onReset: () => void; onClose: () => void;
}) {
  const [activeTab, setActiveTab] = useState<"appearance" | "mentor" | "financial" | "behavior">("appearance");

  const tabs = [
    { id: "appearance" as const, label: "Scope Config", icon: <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="3" /><path d="M12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42" /></svg> },
    { id: "mentor" as const, label: "Learning", icon: <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z" /><path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z" /></svg> },
    { id: "financial" as const, label: "Cost", icon: <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="12" y1="1" x2="12" y2="23" /><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6" /></svg> },
    { id: "behavior" as const, label: "Window", icon: <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="2" y="3" width="20" height="14" rx="2" /><line x1="8" y1="21" x2="16" y2="21" /><line x1="12" y1="17" x2="12" y2="21" /></svg> },
  ];

  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="fixed inset-0 z-[300] flex items-center justify-center" onClick={onClose}>
      <div className="absolute inset-0" style={{ background: "rgba(0,0,0,0.6)", backdropFilter: "blur(8px)" }} />
      <motion.div initial={{ scale: 0.92, y: 20 }} animate={{ scale: 1, y: 0 }} exit={{ scale: 0.95, y: 10 }}
        transition={{ type: "spring", damping: 25, stiffness: 350 }}
        className="relative w-[520px] max-h-[70vh] rounded-2xl border border-white/[0.08] overflow-hidden flex"
        style={{ background: "rgba(10, 12, 18, 0.92)", backdropFilter: "blur(40px)", boxShadow: "0 25px 60px rgba(0,0,0,0.7)" }}
        onClick={e => e.stopPropagation()}>

        <div className="w-[140px] shrink-0 border-r border-white/[0.06] py-4 px-2 flex flex-col gap-1">
          <span className="text-[8px] font-sans font-bold tracking-[0.2em] uppercase text-txt-tertiary px-2 mb-2">Settings</span>
          {tabs.map(t => (
            <button key={t.id} onClick={() => setActiveTab(t.id)}
              className={`flex items-center gap-2 px-2 py-1.5 rounded-md text-[9px] font-sans transition-colors ${activeTab === t.id ? "bg-white/[0.06] text-txt-primary" : "text-txt-secondary hover:text-txt-primary hover:bg-white/[0.03]"}`}>
              <span className={activeTab === t.id ? "text-indigo-400" : "text-txt-tertiary"}>{t.icon}</span>
              {t.label}
            </button>
          ))}
          <div className="mt-auto pt-3 border-t border-white/[0.04]">
            <button onClick={() => { onReset(); onClose(); }} className="w-full px-2 py-1.5 rounded-md text-[8px] font-sans font-bold tracking-[0.12em] uppercase text-red-400/60 hover:text-red-400 hover:bg-red-500/[0.06] transition-colors">
              Factory Reset
            </button>
          </div>
        </div>

        <div className="flex-1 py-4 px-5 overflow-y-auto">
          <AnimatePresence mode="wait">
            <motion.div key={activeTab} initial={{ opacity: 0, x: 8 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -8 }} transition={{ duration: 0.15 }}>

              {activeTab === "appearance" && (
                <div className="space-y-4">
                  <SettingHeader title="Glass Opacity" />
                  <SettingSlider value={settings.glassOpacity} min={0.5} max={1} step={0.05} label={`${Math.round(settings.glassOpacity * 100)}%`} onChange={v => onUpdate({ glassOpacity: v })} />

                  <SettingHeader title="Blur Intensity" />
                  <div className="flex gap-2">
                    {(["none", "low", "high"] as const).map(v => (
                      <button key={v} onClick={() => onUpdate({ blurIntensity: v })}
                        className={`flex-1 py-1.5 rounded-md text-[8px] font-mono uppercase tracking-wider transition-colors ${settings.blurIntensity === v ? "bg-indigo-500/20 text-indigo-300 border border-indigo-400/20" : "bg-white/[0.03] text-txt-tertiary border border-white/[0.06] hover:text-txt-secondary"}`}>
                        {v}
                      </button>
                    ))}
                  </div>

                  <SettingToggle label="Sidebar Depth Shadows" value={settings.sidebarShadows} onChange={v => onUpdate({ sidebarShadows: v })} />

                  <SettingHeader title="Context Sniper" />
                  <SettingToggle label="Auto-Snipe Large Files" value={settings.autoSnipeLargeFiles} onChange={v => onUpdate({ autoSnipeLargeFiles: v })} />
                  <p className="text-[7px] font-sans text-txt-tertiary -mt-2 ml-1">Auto-exclude files over 500 lines to save tokens</p>
                </div>
              )}

              {activeTab === "mentor" && (
                <div className="space-y-4">
                  <SettingToggle label="Code Hotspots" value={settings.hotspotsEnabled} onChange={v => onUpdate({ hotspotsEnabled: v })} />
                  <SettingToggle label="High-Performance Hover" value={settings.simpleHotspots} onChange={v => onUpdate({ simpleHotspots: v })} />
                  <p className="text-[7px] font-sans text-txt-tertiary -mt-2 ml-1">Underline-only mode — no background glow</p>
                  <SettingToggle label="Auto-Expand Rationale" value={settings.rationaleAutoExpand} onChange={v => onUpdate({ rationaleAutoExpand: v })} />
                  <SettingHeader title="Tooltip Delay" />
                  <SettingSlider value={settings.tooltipDelay} min={50} max={800} step={50} label={`${settings.tooltipDelay}ms`} onChange={v => onUpdate({ tooltipDelay: v })} />
                </div>
              )}

              {activeTab === "financial" && (
                <div className="space-y-4">
                  <SettingHeader title="Session Budget" />
                  <SettingSlider value={settings.sessionBudget} min={0} max={50} step={1} label={settings.sessionBudget === 0 ? "Off" : `$${settings.sessionBudget}`} onChange={v => onUpdate({ sessionBudget: v })} />
                  <p className="text-[8px] font-sans text-txt-tertiary">HUD border pulses red when exceeded</p>

                  <SettingHeader title="Token Rates ($/M)" />
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <span className="text-[7px] font-sans font-bold tracking-wider uppercase text-txt-tertiary block mb-1">Input</span>
                      <input type="number" value={settings.inputRate} onChange={e => onUpdate({ inputRate: parseFloat(e.target.value) || 15 })}
                        className="w-full px-2 py-1 rounded-md text-[9px] font-mono text-txt-secondary bg-white/[0.03] border border-white/[0.08] outline-none" />
                    </div>
                    <div>
                      <span className="text-[7px] font-sans font-bold tracking-wider uppercase text-txt-tertiary block mb-1">Output</span>
                      <input type="number" value={settings.outputRate} onChange={e => onUpdate({ outputRate: parseFloat(e.target.value) || 75 })}
                        className="w-full px-2 py-1 rounded-md text-[9px] font-mono text-txt-secondary bg-white/[0.03] border border-white/[0.08] outline-none" />
                    </div>
                  </div>
                </div>
              )}

              {activeTab === "behavior" && (
                <div className="space-y-4">
                  <SettingToggle label="Always on Top" value={settings.alwaysOnTop} onChange={v => { onUpdate({ alwaysOnTop: v }); (window as unknown as Record<string, Record<string, (v: boolean) => void>>).electronAPI?.setAlwaysOnTop(v); }} />
                </div>
              )}
            </motion.div>
          </AnimatePresence>
        </div>
      </motion.div>
    </motion.div>
  );
}

function SettingHeader({ title }: { title: string }) {
  return <span className="text-[8px] font-sans font-bold tracking-[0.18em] uppercase text-txt-tertiary block">{title}</span>;
}

function SettingToggle({ label, value, onChange }: { label: string; value: boolean; onChange: (v: boolean) => void }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-[9px] font-sans text-txt-secondary">{label}</span>
      <button onClick={() => onChange(!value)} className={`w-8 h-4 rounded-full transition-colors relative ${value ? "bg-indigo-500/50" : "bg-white/[0.08]"}`}>
        <div className={`absolute top-0.5 w-3 h-3 rounded-full transition-all ${value ? "left-4 bg-indigo-400" : "left-0.5 bg-white/30"}`} />
      </button>
    </div>
  );
}

function SettingSlider({ value, min, max, step, label, onChange }: { value: number; min: number; max: number; step: number; label: string; onChange: (v: number) => void }) {
  return (
    <div className="flex items-center gap-3">
      <input type="range" min={min} max={max} step={step} value={value} onChange={e => onChange(parseFloat(e.target.value))}
        className="flex-1 h-1 rounded-full appearance-none bg-white/[0.08] accent-indigo-400 cursor-pointer [&::-webkit-slider-thumb]:w-3 [&::-webkit-slider-thumb]:h-3 [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-indigo-400 [&::-webkit-slider-thumb]:appearance-none" />
      <span className="text-[8px] font-mono text-indigo-300/70 w-10 text-right tabular-nums">{label}</span>
    </div>
  );
}
