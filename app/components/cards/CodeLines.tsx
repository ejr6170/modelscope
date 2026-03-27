"use client";
import React, { useState, useEffect, useRef, useCallback } from "react";
import { createPortal } from "react-dom";
import { motion, AnimatePresence } from "framer-motion";
import { CONCEPT_DB, _conceptKeys, _conceptRe, MentorTooltipPortal } from "../MentorTooltip";

export function highlightSyntax(code: string, hotspots = false): string {
  const escaped = code.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const tokenEntries: { text: string; c?: string }[] = []; let remaining = escaped;
  const syntaxPatterns: [RegExp, string][] = [
    [/^(\/\/.*$)/m, "syn-comment"], [/^(#[^!\n].*$)/m, "syn-comment"], [/^(\/\*[\s\S]*?\*\/)/, "syn-comment"],
    [/^("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|`(?:[^`\\]|\\.)*`)/, "syn-string"],
    [/^(\b(?:import|export|from|const|let|var|function|return|if|else|for|while|class|new|async|await|default|interface|type|extends|implements|public|private|static|throw|try|catch|typeof|void|null|undefined|true|false)\b)/, "syn-keyword"],
    [/^(\b[A-Z][a-zA-Z0-9]*\b)/, "syn-type"], [/^(\b\d+\.?\d*\b)/, "syn-number"],
    [/^(\b[a-zA-Z_$][a-zA-Z0-9_$]*\b)/, ""],
  ];
  while (remaining.length > 0) {
    let matched = false;
    for (const [re, className] of syntaxPatterns) { const result = remaining.match(re); if (result?.index === 0) { tokenEntries.push({ text: result[0], c: className || undefined }); remaining = remaining.slice(result[0].length); matched = true; break; } }
    if (!matched) { const last = tokenEntries[tokenEntries.length - 1]; if (last && !last.c) last.text += remaining[0]; else tokenEntries.push({ text: remaining[0] }); remaining = remaining.slice(1); }
  }
  if (hotspots) {
    const conceptRe = hotspots ? _conceptRe : null;

    return tokenEntries.map(tokenEntry => {
      const text = tokenEntry.text;
      const dbKey = _conceptKeys.find(k => k === text || k.toLowerCase() === text.toLowerCase());
      if (dbKey && CONCEPT_DB[dbKey]) {
        return `<span class="mentor-hotspot${tokenEntry.c ? " " + tokenEntry.c : ""}" data-concept="${dbKey}">${text}</span>`;
      }
      if (conceptRe && text.length > 6) {
        let hasMatch = false;
        const replaced = text.replace(conceptRe, (match) => {
          const key = _conceptKeys.find(k => k.toLowerCase() === match.toLowerCase());
          if (key) { hasMatch = true; return `</span><span class="mentor-hotspot" data-concept="${key}">${match}</span><span class="${tokenEntry.c || ""}">`; }
          return match;
        });
        if (hasMatch) {
          return tokenEntry.c ? `<span class="${tokenEntry.c}">${replaced}</span>` : replaced;
        }
      }
      return tokenEntry.c ? `<span class="${tokenEntry.c}">${tokenEntry.text}</span>` : text;
    }).join("");
  }

  return tokenEntries.map(tokenEntry => tokenEntry.c ? `<span class="${tokenEntry.c}">${tokenEntry.text}</span>` : tokenEntry.text).join("");
}

export function CodeLines({ code, maxLines, showLineNums, startLine = 1, isNewFile, onLearnMore }: { code: string; maxLines: number; showLineNums: boolean; startLine?: number; isNewFile?: boolean; onLearnMore?: () => void }) {
  const lines = code.split("\n");
  const display = lines.slice(0, maxLines);
  const maxLineNum = startLine + Math.min(lines.length, maxLines) - 1;
  const gutterW = String(maxLineNum).length;
  const [hoveredEl, setHoveredEl] = useState<{ el: HTMLElement; term: string } | null>(null);
  const enterTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const leaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => {
    if (enterTimerRef.current) clearTimeout(enterTimerRef.current);
    if (leaveTimerRef.current) clearTimeout(leaveTimerRef.current);
  }, []);

  const handleMouseOver = useCallback((e: React.MouseEvent) => {
    const target = e.target as HTMLElement;
    if (target.classList.contains("mentor-hotspot")) {
      if (leaveTimerRef.current) { clearTimeout(leaveTimerRef.current); leaveTimerRef.current = null; }
      if (enterTimerRef.current) clearTimeout(enterTimerRef.current);
      enterTimerRef.current = setTimeout(() => {
        setHoveredEl({ el: target, term: target.dataset.concept || "" });
      }, 150);
    }
  }, []);
  const handleMouseOut = useCallback((e: React.MouseEvent) => {
    if ((e.target as HTMLElement).classList.contains("mentor-hotspot")) {
      if (enterTimerRef.current) { clearTimeout(enterTimerRef.current); enterTimerRef.current = null; }
      if (leaveTimerRef.current) clearTimeout(leaveTimerRef.current);
      leaveTimerRef.current = setTimeout(() => setHoveredEl(null), 200);
    }
  }, []);

  return (
    <pre className="text-[10px] font-mono leading-[1.75] whitespace-pre-wrap relative no-drag" onMouseOver={handleMouseOver} onMouseOut={handleMouseOut}>
      {display.map((line, i) => (
        <div key={i} className={`flex items-start ${isNewFile ? "bg-green-500/[0.05] border-l-2 border-green-500/20 px-1.5 -mx-1.5 rounded" : ""}`}>
          {showLineNums && <span className={`select-none text-right mr-2 shrink-0 tabular-nums ${isNewFile ? "text-green-400/30" : "text-txt-tertiary"}`} style={{ width: `${gutterW}ch` }}>{startLine + i}</span>}
          {isNewFile && <span className="text-green-400/40 select-none mr-1.5 shrink-0">+</span>}
          <span className="flex-1" dangerouslySetInnerHTML={{ __html: highlightSyntax(line, true) }} />
        </div>
      ))}
      {lines.length > maxLines && <div className="text-txt-tertiary mt-1 text-[9px]">...{lines.length - maxLines} more lines from L{startLine + maxLines}</div>}
      {typeof document !== "undefined" && createPortal(
        <AnimatePresence>
          {hoveredEl && <MentorTooltipPortal targetEl={hoveredEl.el} term={hoveredEl.term} onLearnMore={onLearnMore} onClose={() => setHoveredEl(null)} />}
        </AnimatePresence>,
        document.body
      )}
    </pre>
  );
}

export function DiffLines({ removed, added, maxLines, showLineNums, startLine = 1, onLearnMore }: { removed: string; added: string; maxLines: number; showLineNums: boolean; startLine?: number; onLearnMore?: () => void }) {
  const rmLines = removed.split("\n");
  const adLines = added.split("\n");
  const rmShow = rmLines.slice(0, Math.min(rmLines.length, Math.ceil(maxLines / 2)));
  const adShow = adLines.slice(0, Math.min(adLines.length, Math.floor(maxLines / 2)));
  const maxLineNum = startLine + Math.max(rmLines.length, adLines.length) - 1;
  const gutterW = String(maxLineNum).length;
  const [hoveredEl, setHoveredEl] = useState<{ el: HTMLElement; term: string } | null>(null);
  const enterTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const leaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => {
    if (enterTimerRef.current) clearTimeout(enterTimerRef.current);
    if (leaveTimerRef.current) clearTimeout(leaveTimerRef.current);
  }, []);

  const handleMouseOver = useCallback((e: React.MouseEvent) => {
    const target = e.target as HTMLElement;
    if (target.classList.contains("mentor-hotspot")) {
      if (leaveTimerRef.current) { clearTimeout(leaveTimerRef.current); leaveTimerRef.current = null; }
      if (enterTimerRef.current) clearTimeout(enterTimerRef.current);
      enterTimerRef.current = setTimeout(() => {
        setHoveredEl({ el: target, term: target.dataset.concept || "" });
      }, 150);
    }
  }, []);
  const handleMouseOut = useCallback((e: React.MouseEvent) => {
    if ((e.target as HTMLElement).classList.contains("mentor-hotspot")) {
      if (enterTimerRef.current) { clearTimeout(enterTimerRef.current); enterTimerRef.current = null; }
      if (leaveTimerRef.current) clearTimeout(leaveTimerRef.current);
      leaveTimerRef.current = setTimeout(() => setHoveredEl(null), 200);
    }
  }, []);

  return (
    <pre className="text-[10px] font-mono leading-[1.75] whitespace-pre-wrap relative no-drag" onMouseOver={handleMouseOver} onMouseOut={handleMouseOut}>
      {rmShow.map((line, i) => (
        <div key={`r${i}`} className="flex items-start bg-red-500/[0.08] px-1.5 -mx-1.5 rounded border-l-2 border-red-500/30">
          <span className="select-none text-red-400/30 text-right mr-2 shrink-0 tabular-nums" style={{ width: `${gutterW}ch` }}>{startLine + i}</span>
          <span className="text-red-400 select-none mr-1.5 shrink-0 font-bold">-</span>
          <span className="flex-1 text-red-300/80" dangerouslySetInnerHTML={{ __html: highlightSyntax(line, true) }} />
        </div>
      ))}
      {rmShow.length > 0 && adShow.length > 0 && <div className="h-1" />}
      {adShow.map((line, i) => (
        <div key={`a${i}`} className="flex items-start bg-green-500/[0.08] px-1.5 -mx-1.5 rounded border-l-2 border-green-500/30">
          <span className="select-none text-green-400/30 text-right mr-2 shrink-0 tabular-nums" style={{ width: `${gutterW}ch` }}>{startLine + i}</span>
          <span className="text-green-400 select-none mr-1.5 shrink-0 font-bold">+</span>
          <span className="flex-1 text-green-300/80" dangerouslySetInnerHTML={{ __html: highlightSyntax(line, true) }} />
        </div>
      ))}
      {(rmLines.length > rmShow.length || adLines.length > adShow.length) && (
        <div className="text-txt-tertiary mt-1 text-[9px]">...truncated from L{startLine + Math.max(rmShow.length, adShow.length)}</div>
      )}
      {typeof document !== "undefined" && createPortal(
        <AnimatePresence>
          {hoveredEl && <MentorTooltipPortal targetEl={hoveredEl.el} term={hoveredEl.term} onLearnMore={onLearnMore} onClose={() => setHoveredEl(null)} />}
        </AnimatePresence>,
        document.body
      )}
    </pre>
  );
}

export function DiffModal({ card, onClose }: { card: { filename?: string; fullPath?: string; code?: string; diff?: { removed: string; added: string }; lineInfo?: { startLine: number; endLine: number }; isNewFile?: boolean } ; onClose: () => void }) {
  const isDiff = !!card.diff;
  const [copied, setCopied] = useState(false);

  const copyPath = () => {
    navigator.clipboard.writeText((card.fullPath || card.filename || "").replace(/\//g, "\\"));
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.25 }}
      className="fixed inset-0 z-50 flex items-center justify-center p-6"
      onClick={onClose}
    >
      <div className="absolute inset-0" style={{ background: "rgba(0, 0, 0, 0.7)", backdropFilter: "blur(20px) saturate(150%)" }} />

      <motion.div
        initial={{ scale: 0.95, y: 20 }}
        animate={{ scale: 1, y: 0 }}
        exit={{ scale: 0.95, y: 20 }}
        transition={{ duration: 0.3, ease: [0.16, 1, 0.3, 1] }}
        className="relative w-full max-w-[90vw] max-h-[85vh] rounded-2xl border border-glass-border overflow-hidden flex flex-col"
        style={{ boxShadow: "0 25px 60px rgba(0, 0, 0, 0.6), var(--glass-glow)" }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-2.5 px-4 py-3 bg-white/[0.04] border-b border-glass-border shrink-0">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="text-txt-secondary"><path d="M13 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z" /><polyline points="13 2 13 9 20 9" /></svg>
          <span className="text-[11px] font-mono text-txt-primary font-medium">{card.filename}</span>
          {card.lineInfo && <span className="text-[9px] font-mono px-1.5 py-0.5 rounded-md bg-cyan-500/10 text-cyan-400/80 tabular-nums">L{card.lineInfo.startLine}\u2013L{card.lineInfo.endLine}</span>}
          <button onClick={copyPath} className="text-[9px] font-mono px-2 py-0.5 rounded-md bg-white/[0.06] hover:bg-white/[0.10] text-txt-secondary hover:text-txt-primary transition-colors" title="Copy path">
            {copied ? "Copied!" : "Copy Path"}
          </button>
          <span className={`text-[8px] font-mono font-bold px-1.5 py-0.5 rounded-md tracking-wider uppercase ${isDiff ? "bg-amber-500/15 text-amber-400/90" : "bg-emerald-500/15 text-emerald-400/90"}`}>{isDiff ? "diff" : "write"}</span>
          <div className="flex-1" />
          <button onClick={onClose} className="text-[11px] text-txt-tertiary hover:text-txt-primary transition-colors px-2 py-1 rounded-md hover:bg-white/[0.06]">{"\u2715"} Close</button>
        </div>

        <div className="flex-1 overflow-auto px-4 py-3" style={{ background: "var(--code-bg)" }}>
          {isDiff && card.diff
            ? <DiffLines removed={card.diff.removed} added={card.diff.added} maxLines={9999} showLineNums={true} startLine={card.lineInfo?.startLine || 1} />
            : <CodeLines code={card.code || ""} maxLines={9999} showLineNums={true} startLine={card.lineInfo?.startLine || 1} isNewFile={card.isNewFile} />
          }
        </div>
      </motion.div>
    </motion.div>
  );
}
