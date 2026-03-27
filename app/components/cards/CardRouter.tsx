"use client";
import React, { useState, useEffect, useRef, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import type { SessionEvent, FeedCard, ToolInput, ToolUse } from "../types";
import { shortPath } from "../shared";
import { highlightSyntax, CodeLines, DiffLines, DiffModal } from "./CodeLines";

export function eventToCards(event: SessionEvent): FeedCard[] {
  const cards: FeedCard[] = [];
  const ts = event.timestamp;
  const nested = event.isSubagentEvent || event.isSidechain || false;

  const turnTokens = event.tokens ? (event.tokens.input + event.tokens.output) : undefined;
  const turnCost = event.costUSD || undefined;
  const turnInputTokens = event.tokens?.input;
  const turnOutputTokens = event.tokens?.output;

  if (event.role === "assistant") {
    const rationale = event.thinking?.filter(Boolean).join(" ").slice(0, 500) || undefined;

    if (event.thinking?.length) {
      const thinkingText = event.thinking.filter(Boolean).join(" ");
      if (thinkingText) cards.push({ id: `${event.uuid}-think`, kind: "thought", timestamp: ts, text: thinkingText, model: event.model, isNested: nested, agentId: event.agentId || undefined, turnTokens, turnCost, turnInputTokens, turnOutputTokens });
    }
    if (event.text?.length) cards.push({ id: `${event.uuid}-reply`, kind: "reply", timestamp: ts, text: event.text.join("\n"), model: event.model, isNested: nested, agentId: event.agentId || undefined, turnTokens, turnCost, rationale });
    if (event.toolUses?.length) {
      for (const tool of event.toolUses) {
        const inp = tool.input || {};

        if (tool.isSubagent) {
          cards.push({ id: `${event.uuid}-sa-${tool.id}`, kind: "subagent", timestamp: ts, subagentType: tool.subagentType, subagentDesc: tool.subagentDesc, toolName: "Agent", turnTokens, turnCost, rationale, subagentMission: (inp as ToolInput).prompt as string || undefined });
          continue;
        }

        if (tool.tool === "Read") {
          cards.push({ id: `${event.uuid}-rd-${tool.id}`, kind: "read", timestamp: ts, filename: shortPath(inp.file), readSource: tool.readSource || "Direct", isNested: nested, turnTokens, turnCost, turnInputTokens, turnOutputTokens });
          continue;
        }

        if (tool.tool === "Write" && inp.content) { cards.push({ id: `${event.uuid}-c-${tool.id}`, kind: "code", timestamp: ts, filename: shortPath(inp.file), fullPath: inp.file, code: inp.content, isNested: nested, lineInfo: tool.lineInfo, isNewFile: (tool as ToolUse & { isNewFile?: boolean }).isNewFile, turnTokens, turnCost, rationale }); continue; }
        if (tool.tool === "Edit" && (inp.oldString || inp.newString)) { cards.push({ id: `${event.uuid}-d-${tool.id}`, kind: "code", timestamp: ts, filename: shortPath(inp.file), fullPath: inp.file, diff: { removed: inp.oldString || "", added: inp.newString || "" }, isNested: nested, lineInfo: tool.lineInfo, turnTokens, turnCost, rationale }); continue; }
        if (tool.tool === "Bash" && inp.command) { cards.push({ id: `${event.uuid}-b-${tool.id}`, kind: "tool", timestamp: ts, toolName: "Terminal", toolSummary: inp.command, isNested: nested, turnTokens, turnCost, rationale }); continue; }
        cards.push({ id: `${event.uuid}-t-${tool.id}`, kind: "tool", timestamp: ts, toolName: tool.tool, toolSummary: formatToolSummary(tool.tool, inp), isNested: nested, turnTokens, turnCost, rationale });
      }
    }
  }

  if (event.role === "user") {
    event.toolResults?.filter(tr => tr.isError).forEach(tr =>
      cards.push({ id: `${event.uuid}-e-${tr.toolUseId}`, kind: "error", timestamp: ts, text: tr.content, isError: true, isNested: nested })
    );
    const text = (event as unknown as Record<string, unknown>).text as string | undefined;
    if (text) { const cleaned = text.replace(/<[^>]+>/g, "").trim(); if (cleaned && !cleaned.startsWith("[Request") && cleaned.length > 2) cards.push({ id: `${event.uuid}-u`, kind: "user", timestamp: ts, text: cleaned }); }
  }
  return cards;
}

function formatToolSummary(toolName: string, input: ToolInput): string {
  switch (toolName) { case "Glob": return input.pattern || ""; case "Grep": return `/${input.pattern || ""}/`; case "Agent": return input.description || ""; case "ToolSearch": return String(input.query || ""); default: return Object.values(input).filter(v => typeof v === "string").join(" ").slice(0, 80); }
}

export function formatTranscriptTool(name: string, input: Record<string, unknown>): string {
  const sp = (f: unknown) => shortPath(String(f || ""));
  switch (name) {
    case "Edit": return `[Edit: ${sp(input.file_path)}]`;
    case "Write": {
      const lines = typeof input.content === "string" ? input.content.split("\n").length : 0;
      return `[Write: ${sp(input.file_path)} (${lines} lines)]`;
    }
    case "Bash": return `[Terminal: ${String(input.command || input.description || "").slice(0, 80)}]`;
    case "Read": return `[Read: ${sp(input.file_path)}]`;
    case "Glob": return `[Search: ${String(input.pattern || "")}]`;
    case "Grep": {
      const p = String(input.pattern || "");
      const path = input.path ? ` in ${sp(input.path)}` : "";
      return `[Search: "${p}"${path}]`;
    }
    case "Agent": return `[Agent: "${String(input.description || "").slice(0, 60)}"]`;
    default: return `[${name}]`;
  }
}

export const cardMotion = { initial: { opacity: 0, y: 14, scale: 0.97 }, animate: { opacity: 1, y: 0, scale: 1 }, exit: { opacity: 0, y: -8, scale: 0.98 } };
export const cardTr = { duration: 0.3, ease: [0.16, 1, 0.3, 1] as const };

export const CostBadge = React.memo(function CostBadge({ tokens, cost, inputTokens, outputTokens }: { tokens?: number; cost?: number; inputTokens?: number; outputTokens?: number }) {
  const [showBreakdown, setShowBreakdown] = useState(false);

  const [displayTok, setDisplayTok] = useState(0);
  const [displayCost, setDisplayCost] = useState(0);
  const targetTok = tokens || 0;
  const targetCost = cost || 0;

  useEffect(() => {
    if (targetTok === 0 && targetCost === 0) return;
    const duration = 400;
    const start = performance.now();
    let raf: number;
    const tick = (now: number) => {
      const elapsed = now - start;
      const progress = Math.min(elapsed / duration, 1);
      const eased = 1 - Math.pow(1 - progress, 3);
      setDisplayTok(Math.round(targetTok * eased));
      setDisplayCost(targetCost * eased);
      if (progress < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [targetTok, targetCost]);

  if (!tokens && !cost) return null;

  const tokLabel = displayTok >= 1000 ? `${(displayTok / 1000).toFixed(1)}k` : String(displayTok);
  const costLabel = displayCost >= 0.005 ? `$${displayCost.toFixed(3)}` : displayCost > 0 ? `$${displayCost.toFixed(4)}` : "";

  const isHighCost = targetCost >= 0.10;
  const isCriticalCost = targetCost >= 0.50;

  const glowClass = isCriticalCost
    ? "animate-pulse bg-red-500/15 border-red-400/20 text-red-300/90"
    : isHighCost
    ? "bg-amber-500/10 border-amber-400/15 text-amber-300/80"
    : "bg-white/[0.04] border-white/[0.06] text-txt-tertiary";

  const inLabel = inputTokens ? (inputTokens >= 1000 ? `${(inputTokens / 1000).toFixed(1)}k` : String(inputTokens)) : null;
  const outLabel = outputTokens ? (outputTokens >= 1000 ? `${(outputTokens / 1000).toFixed(1)}k` : String(outputTokens)) : null;

  return (
    <span className={`relative inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full border text-[8px] font-mono tabular-nums shrink-0 ${glowClass}`}
          style={isCriticalCost ? { boxShadow: "0 0 8px rgba(248, 113, 113, 0.2)" } : isHighCost ? { boxShadow: "0 0 6px rgba(251, 191, 36, 0.15)" } : undefined}
          onMouseEnter={() => setShowBreakdown(true)} onMouseLeave={() => setShowBreakdown(false)}>
      <span className="text-indigo-300/70">{tokLabel}</span>
      {costLabel && <><span className="text-txt-tertiary/40">|</span><span className="text-emerald-400/80">{costLabel}</span></>}
      {showBreakdown && (inLabel || outLabel) && (
        <span className="absolute z-50 bottom-full left-1/2 -translate-x-1/2 mb-1.5 px-2 py-1 rounded-md text-[7px] whitespace-nowrap pointer-events-none"
              style={{ background: "rgba(10, 10, 25, 0.92)", border: "1px solid rgba(255,255,255,0.08)" }}>
          {inLabel && <span className="text-indigo-300/60">In: {inLabel}</span>}
          {inLabel && outLabel && <span className="text-txt-tertiary/30 mx-1">|</span>}
          {outLabel && <span className="text-indigo-300/60">Out: {outLabel}</span>}
        </span>
      )}
    </span>
  );
});

function RationaleToggle({ rationale }: { rationale?: string }) {
  const [open, setOpen] = useState(false);
  if (!rationale) return null;

  return (
    <div className="mt-2">
      <button
        onClick={() => setOpen(!open)}
        className="flex items-center gap-1.5 text-[8px] font-sans font-semibold tracking-[0.12em] uppercase text-indigo-300/60 hover:text-indigo-300/90 transition-colors"
      >
        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="shrink-0">
          <path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z" /><path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z" />
        </svg>
        {open ? "Hide Rationale" : "Design Rationale"}
        <motion.span animate={{ rotate: open ? 180 : 0 }} transition={{ duration: 0.2 }} className="text-[10px]">{"\u25BE"}</motion.span>
      </button>
      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.25, ease: [0.16, 1, 0.3, 1] }}
            className="overflow-hidden"
          >
            <p className="text-[10px] font-sans italic leading-[1.7] text-indigo-300/70 mt-1.5 pl-3 border-l border-indigo-400/20">
              {rationale.length > 400 ? rationale.slice(0, 400) + "..." : rationale}
            </p>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function CardWrap({ card, children }: { card: FeedCard; children: React.ReactNode }) {
  if (card.isNested) {
    return (
      <div className="flex">
        <div className="flex flex-col items-center mr-2 shrink-0">
          <div className="w-px flex-1 bg-indigo-400/20" />
          <div className="w-2 h-2 rounded-full bg-indigo-400/30 shrink-0 my-0.5" />
          <div className="w-px flex-1 bg-indigo-400/20" />
        </div>
        <div className="flex-1 min-w-0 opacity-85">{children}</div>
      </div>
    );
  }
  if (card.isError) {
    return <div style={{ boxShadow: "0 0 15px rgba(255, 0, 0, 0.2), var(--glass-glow)" }}>{children}</div>;
  }
  return <>{children}</>;
}

export function Timestamp({ ts }: { ts: string }) { if (!ts) return null; return <span className="text-[8px] font-mono text-txt-tertiary ml-auto tabular-nums">{new Date(ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })}</span>; }
function AgentBadge({ id }: { id: string }) { return <span className="text-[7px] font-mono px-1 py-0.5 rounded bg-indigo-500/20 text-indigo-300/70">{id.slice(0, 7)}</span>; }

function ThoughtCard({ card }: { card: FeedCard }) {
  return (
    <div className="px-4 py-3 rounded-xl bg-white/[0.03] border border-violet-400/[0.08]" style={{ boxShadow: "var(--glass-glow)" }}>
      <div className="flex items-center gap-2 mb-2"><div className="w-1.5 h-1.5 rounded-full bg-violet-400/60" /><span className="text-[9px] font-sans font-semibold tracking-[0.15em] uppercase text-violet-400/70">Thinking</span>{card.agentId && <AgentBadge id={card.agentId} />}<Timestamp ts={card.timestamp} /><CostBadge tokens={card.turnTokens} cost={card.turnCost} inputTokens={card.turnInputTokens} outputTokens={card.turnOutputTokens} /></div>
      <p className="text-[12px] leading-[1.7] text-txt-secondary italic font-light">{(card.text || "").slice(0, 400)}</p>
    </div>
  );
}

function ReplyCard({ card }: { card: FeedCard }) {
  return (
    <div className="px-4 py-3 rounded-xl bg-white/[0.03] border border-white/[0.08]" style={{ boxShadow: "var(--glass-glow)" }}>
      <div className="flex items-center gap-2 mb-2"><div className="w-1.5 h-1.5 rounded-full bg-cyan-400/70" /><span className="text-[9px] font-sans font-semibold tracking-[0.15em] uppercase text-cyan-400/70">Response</span>{card.agentId && <AgentBadge id={card.agentId} />}<Timestamp ts={card.timestamp} /><CostBadge tokens={card.turnTokens} cost={card.turnCost} inputTokens={card.turnInputTokens} outputTokens={card.turnOutputTokens} /></div>
      <p className="text-[12px] leading-[1.7] text-txt-primary font-normal whitespace-pre-wrap">{(card.text || "").slice(0, 500)}</p>
      <RationaleToggle rationale={card.rationale} />
    </div>
  );
}

function ReadCard({ card }: { card: FeedCard }) {
  const sourceColors: Record<string, string> = {
    "Project Rules": "bg-amber-500/20 text-amber-300/90",
    "Memory": "bg-violet-500/20 text-violet-300/90",
    "Config": "bg-slate-500/20 text-slate-300/90",
    "Manifest": "bg-blue-500/20 text-blue-300/90",
    "Pinned": "bg-emerald-500/20 text-emerald-300/90",
    "Search Result": "bg-cyan-500/20 text-cyan-300/90",
    "Direct": "bg-white/10 text-txt-secondary",
    "Env": "bg-red-500/20 text-red-300/90",
  };
  const src = card.readSource || "Direct";
  const badgeColor = sourceColors[src] || sourceColors["Direct"];

  return (
    <div className="px-3 py-2.5 rounded-lg bg-white/[0.03] border border-white/[0.08] flex items-center gap-2.5" style={{ boxShadow: "var(--glass-glow)" }}>
      <span className="text-[11px] font-mono text-blue-400/70 shrink-0">&#9671;</span>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="text-[9px] font-sans font-semibold tracking-[0.15em] uppercase text-blue-400/70">Read</span>
          <span className={`text-[8px] font-mono font-bold px-1.5 py-0.5 rounded-md tracking-wide uppercase ${badgeColor}`}>{src}</span>
          <Timestamp ts={card.timestamp} /><CostBadge tokens={card.turnTokens} cost={card.turnCost} inputTokens={card.turnInputTokens} outputTokens={card.turnOutputTokens} />
        </div>
        <p className="text-[10px] font-mono text-txt-secondary mt-1 truncate">{card.filename}</p>
      </div>
    </div>
  );
}

function SubagentCard({ card }: { card: FeedCard }) {
  const [missionOpen, setMissionOpen] = useState(false);
  return (
    <div className="px-4 py-3 rounded-xl bg-indigo-500/[0.08] border border-indigo-400/[0.12]" style={{ boxShadow: "0 0 12px rgba(99, 102, 241, 0.1), var(--glass-glow)" }}>
      <div className="flex items-center gap-2 mb-2">
        <div className="w-2 h-2 rounded-full bg-indigo-400/70 animate-pulse" />
        <button onClick={() => setMissionOpen(!missionOpen)} className="text-[9px] font-sans font-bold tracking-[0.15em] uppercase text-indigo-400/90 hover:text-indigo-300 transition-colors cursor-pointer">Subagent</button>
        <span className="text-[8px] font-mono px-1.5 py-0.5 rounded-md bg-indigo-500/20 text-indigo-300/80">{card.subagentType}</span>
        <Timestamp ts={card.timestamp} /><CostBadge tokens={card.turnTokens} cost={card.turnCost} inputTokens={card.turnInputTokens} outputTokens={card.turnOutputTokens} />
      </div>
      <p className="text-[11px] font-sans text-indigo-200/70">{card.subagentDesc}</p>
      <AnimatePresence>
        {missionOpen && card.subagentMission && (
          <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={{ duration: 0.25 }} className="overflow-hidden">
            <div className="mt-2 pt-2 border-t border-indigo-400/10">
              <span className="text-[8px] font-sans font-bold tracking-[0.15em] uppercase text-indigo-400/50 block mb-1">Mission Prompt</span>
              <p className="text-[9px] font-mono text-indigo-200/50 leading-[1.7] whitespace-pre-wrap">{card.subagentMission.slice(0, 500)}</p>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
      <RationaleToggle rationale={card.rationale} />
    </div>
  );
}

const PREVIEW_LINES = 5;
const MODAL_THRESHOLD = 50;

function CodeCard({ card, onLearnMore }: { card: FeedCard; onLearnMore?: () => void }) {
  const [expanded, setExpanded] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const copyTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (copyTimerRef.current) clearTimeout(copyTimerRef.current); }, []);
  const isDiff = !!card.diff;

  const totalLines = isDiff
    ? (card.diff?.removed.split("\n").length || 0) + (card.diff?.added.split("\n").length || 0)
    : (card.code || "").split("\n").length;
  const isLarge = totalLines > MODAL_THRESHOLD;
  const canExpand = totalLines > PREVIEW_LINES;

  const startLine = card.lineInfo?.startLine || 1;
  const endLine = card.lineInfo?.endLine || (startLine + totalLines - 1);
  const hasRealLines = !!card.lineInfo && (isDiff || startLine > 1);
  const lineRange = hasRealLines ? `L${startLine}\u2013L${endLine}` : `${totalLines}L`;

  const handleExpand = () => {
    if (isLarge) setModalOpen(true);
    else setExpanded(!expanded);
  };

  const copyPath = () => {
    const p = card.fullPath || card.filename || "";
    navigator.clipboard.writeText(p.replace(/\//g, "\\"));
    setCopied(true);
    if (copyTimerRef.current) clearTimeout(copyTimerRef.current);
    copyTimerRef.current = setTimeout(() => setCopied(false), 1500);
  };

  return (
    <>
      <div className="rounded-xl overflow-hidden border border-code-border" style={{ boxShadow: "var(--glass-glow)" }}>
        <div className="flex items-center gap-2 px-3 py-2 bg-white/[0.03] border-b border-white/[0.06]">
          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="text-txt-secondary shrink-0"><path d="M13 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z" /><polyline points="13 2 13 9 20 9" /></svg>
          <span className="text-[10px] font-mono text-txt-secondary truncate">{card.filename}</span>
          <span className={`text-[8px] font-mono tabular-nums px-1 py-0.5 rounded ${hasRealLines ? "bg-cyan-500/10 text-cyan-400/80" : "text-txt-tertiary"}`}>{lineRange}</span>
          <button onClick={copyPath} className="text-[8px] font-mono px-1 py-0.5 rounded bg-white/[0.04] hover:bg-white/[0.08] text-txt-tertiary hover:text-txt-secondary transition-colors shrink-0" title="Copy full path">
            {copied ? "\u2713" : "\u2398"}
          </button>
          <Timestamp ts={card.timestamp} />
          <span className={`ml-auto text-[8px] font-mono font-bold px-1.5 py-0.5 rounded-md tracking-wider uppercase ${isDiff ? "bg-amber-500/15 text-amber-400/90" : card.isNewFile ? "bg-emerald-500/20 text-emerald-400" : "bg-emerald-500/15 text-emerald-400/90"}`}>{isDiff ? "diff" : card.isNewFile ? "new" : "write"}</span>
        </div>

        <div className="relative" style={{ background: "var(--code-bg)" }}>
          <motion.div
            className="px-3 py-2.5 overflow-x-auto"
            animate={{ height: "auto" }}
            transition={{ duration: 0.35, ease: [0.16, 1, 0.3, 1] }}
          >
            {isDiff && card.diff
              ? <DiffLines removed={card.diff.removed} added={card.diff.added} maxLines={expanded ? 999 : PREVIEW_LINES} showLineNums={expanded} startLine={startLine} onLearnMore={onLearnMore} />
              : <CodeLines code={card.code || ""} maxLines={expanded ? 999 : PREVIEW_LINES} showLineNums={expanded} startLine={startLine} isNewFile={card.isNewFile} onLearnMore={onLearnMore} />
            }
          </motion.div>

          {canExpand && !expanded && (
            <div className="absolute bottom-0 left-0 right-0">
              <div className="h-8 bg-gradient-to-t from-[#0d1117] to-transparent" />
              <button onClick={handleExpand}
                className="w-full py-1.5 text-[9px] font-mono font-semibold text-txt-secondary hover:text-txt-primary bg-[#0d1117] hover:bg-white/[0.04] border-t border-code-border transition-colors tracking-wider uppercase">
                {isLarge ? `Open Full View \u00b7 ${lineRange}` : `Expand \u00b7 ${lineRange}`}
              </button>
            </div>
          )}
          {expanded && canExpand && (
            <button onClick={() => setExpanded(false)}
              className="w-full py-1.5 text-[9px] font-mono font-semibold text-txt-tertiary hover:text-txt-secondary bg-[#0d1117] hover:bg-white/[0.04] border-t border-code-border transition-colors tracking-wider uppercase">
              Collapse
            </button>
          )}
        </div>
        {card.rationale && <div className="px-3 pb-2"><RationaleToggle rationale={card.rationale} /></div>}
      </div>

      <AnimatePresence>
        {modalOpen && (
          <DiffModal card={card} onClose={() => setModalOpen(false)} />
        )}
      </AnimatePresence>
    </>
  );
}

function ToolCard({ card }: { card: FeedCard }) {
  const isTerm = card.toolName === "Terminal";
  return (
    <div className={`px-3 py-2.5 rounded-lg bg-white/[0.03] border border-white/[0.08] flex items-start gap-2.5 ${isTerm ? "border-amber-400/[0.08]" : "border-glass-border"}`} style={{ boxShadow: "var(--glass-glow)" }}>
      <span className={`text-[11px] font-mono font-bold mt-0.5 shrink-0 ${isTerm ? "text-amber-400/80" : "text-blue-400/70"}`}>{isTerm ? "\u203a_" : "\u25e6"}</span>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2"><span className={`text-[9px] font-sans font-semibold tracking-[0.15em] uppercase ${isTerm ? "text-amber-400/80" : "text-blue-400/70"}`}>{card.toolName}</span><Timestamp ts={card.timestamp} /><CostBadge tokens={card.turnTokens} cost={card.turnCost} inputTokens={card.turnInputTokens} outputTokens={card.turnOutputTokens} /></div>
        {card.toolSummary && <p className={`text-[10px] font-mono leading-relaxed mt-1 break-all ${isTerm ? "text-amber-200/60" : "text-txt-secondary"}`}>{card.toolSummary.slice(0, 180)}</p>}
      </div>
    </div>
  );
}

function UserCard({ card }: { card: FeedCard }) {
  return (
    <div className="px-4 py-3 rounded-xl bg-white/[0.03] border border-emerald-400/[0.08]" style={{ boxShadow: "var(--glass-glow)" }}>
      <div className="flex items-center gap-2 mb-2"><div className="w-1.5 h-1.5 rounded-full bg-emerald-400/60" /><span className="text-[9px] font-sans font-semibold tracking-[0.15em] uppercase text-emerald-400/70">You</span><Timestamp ts={card.timestamp} /></div>
      <p className="text-[12px] leading-[1.65] text-txt-primary font-normal">{(card.text || "").slice(0, 250)}</p>
    </div>
  );
}

function ErrorCard({ card }: { card: FeedCard }) {
  return (
    <div className="px-3 py-2.5 rounded-lg bg-red-500/[0.08] border border-red-400/[0.15]" style={{ boxShadow: "0 0 15px rgba(255, 0, 0, 0.2), var(--glass-glow)" }}>
      <div className="flex items-center gap-2 mb-1"><span className="text-[9px] font-mono font-bold text-red-400/90 tracking-wider">ERROR</span><Timestamp ts={card.timestamp} /></div>
      <p className="text-[10px] font-mono text-red-300/70 leading-relaxed">{(card.text || "").slice(0, 200)}</p>
    </div>
  );
}

export const CardRouter = React.memo(function CardRouter({ card, onLearnMore }: { card: FeedCard; onLearnMore?: () => void }) {
  const inner = (() => {
    switch (card.kind) {
      case "thought": return <ThoughtCard card={card} />;
      case "reply": return <ReplyCard card={card} />;
      case "code": return <CodeCard card={card} onLearnMore={onLearnMore} />;
      case "tool": return <ToolCard card={card} />;
      case "user": return <UserCard card={card} />;
      case "error": return <ErrorCard card={card} />;
      case "subagent": return <SubagentCard card={card} />;
      case "read": return <ReadCard card={card} />;
      default: return null;
    }
  })();
  return <CardWrap card={card}>{inner}</CardWrap>;
});
