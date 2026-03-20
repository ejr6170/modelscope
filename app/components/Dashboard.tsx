"use client";

import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { createPortal } from "react-dom";
import { motion, AnimatePresence } from "framer-motion";
import { io, Socket } from "socket.io-client";

interface ToolInput {
  command?: string; description?: string; file?: string; content?: string;
  lines?: number; oldString?: string; newString?: string; replaceAll?: boolean;
  pattern?: string; path?: string; outputMode?: string; type?: string; query?: string;
  background?: boolean;
  [key: string]: unknown;
}

interface LineHunk { startLine: number; lineCount: number; }
interface LineInfo { startLine: number; endLine: number; hunks: LineHunk[]; }

interface ToolUse {
  tool: string; id: string; input: ToolInput | null;
  callerType?: string; readSource?: string;
  isSubagent?: boolean; subagentType?: string; subagentDesc?: string; subagentBackground?: boolean;
  lineInfo?: LineInfo;
}

interface SessionEvent {
  uuid: string; timestamp: string; type: string; role?: string; model?: string;
  thinking?: string[]; text?: string[]; toolUses?: ToolUse[];
  tokens?: { input: number; output: number; cacheRead: number; cacheWrite: number };
  costUSD?: number; stopReason?: string | null;
  toolResults?: { toolUseId: string; content: string; isError: boolean }[];
  isSidechain?: boolean; agentId?: string; isSubagentEvent?: boolean;
}

interface ModelBreakdown { model: string; tokens: number; pct: number; }
interface PlanInfo { subscriptionType: string; rateLimitTier: string; }

interface Metrics {
  tokens: { input: number; output: number; cacheRead: number; cacheWrite: number };
  cost: number; turns: number; toolCalls: number;
  elapsed: number; velocity: number; startTime: number;
  hourlyTurns: number; topFiles: { file: string; count: number }[];
  errorCount: number; activeSubagents: { id: string; type: string; desc: string; startTime: string }[];
  plan?: PlanInfo; modelBreakdown?: ModelBreakdown[];
  usage?: { sessionPercent: number | null; weeklyPercent: number | null; sonnetPercent: number | null; resetAt: string | null; resetLabel: string | null; lastUpdated: string | null; source: string };
  rollingVelocity?: number;
  efficiencyRatio?: number;
}

interface SessionInfo { sessionId: string; project: string; startedAt: string; }
interface PinnedError { id: string; timestamp: string; content: string; toolUseId: string; }

interface ProjectInfo {
  id: string;
  name: string;
  lastActive: string | null;
  lastActiveMtime: number;
  isLive: boolean;
  sessionCount: number;
}

type CardKind = "thought" | "reply" | "code" | "tool" | "user" | "error" | "subagent" | "read";

interface FeedCard {
  id: string; kind: CardKind; timestamp: string; text?: string;
  filename?: string; code?: string; diff?: { removed: string; added: string };
  toolName?: string; toolSummary?: string; model?: string;
  subagentType?: string; subagentDesc?: string; isNested?: boolean; agentId?: string;
  readSource?: string;
  isError?: boolean;
  fullPath?: string;
  lineInfo?: LineInfo;
  isNewFile?: boolean;
  turnTokens?: number;
  turnCost?: number;
  turnInputTokens?: number;
  turnOutputTokens?: number;
  rationale?: string;
  subagentMission?: string;
}

function eventToCards(event: SessionEvent): FeedCard[] {
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

function shortPath(f?: string): string { if (!f) return ""; const p = f.replace(/\\/g, "/").split("/"); return p.length > 2 ? p.slice(-2).join("/") : f; }
function formatToolSummary(toolName: string, input: ToolInput): string {
  switch (toolName) { case "Glob": return input.pattern || ""; case "Grep": return `/${input.pattern || ""}/`; case "Agent": return input.description || ""; case "ToolSearch": return String(input.query || ""); default: return Object.values(input).filter(v => typeof v === "string").join(" ").slice(0, 80); }
}

function highlightSyntax(code: string, hotspots = false): string {
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
    const conceptKeys = Object.keys(CONCEPT_DB).filter(k => k.length > 3);
    const conceptRe = conceptKeys.length > 0 ? new RegExp(`\\b(${conceptKeys.join("|")})\\b`, "gi") : null;

    return tokenEntries.map(tokenEntry => {
      const text = tokenEntry.text;
      const dbKey = conceptKeys.find(k => k === text || k.toLowerCase() === text.toLowerCase());
      if (dbKey && CONCEPT_DB[dbKey]) {
        return `<span class="mentor-hotspot${tokenEntry.c ? " " + tokenEntry.c : ""}" data-concept="${dbKey}">${text}</span>`;
      }
      if (conceptRe && text.length > 6) {
        let hasMatch = false;
        const replaced = text.replace(conceptRe, (match) => {
          const key = conceptKeys.find(k => k.toLowerCase() === match.toLowerCase());
          if (key) { hasMatch = true; return `</span><span class="mentor-hotspot" data-concept="${key}">${match}</span><span class="${tokenEntry.c || ""}">`; }
          return match;
        });
        if (hasMatch) {
          return tokenEntry.c ? `<span class="${tokenEntry.c}">${replaced}</span>` : replaced;
        }
      }
      return tokenEntry.c ? `<span class="${tokenEntry.c}">${text}</span>` : text;
    }).join("");
  }

  return tokenEntries.map(tokenEntry => tokenEntry.c ? `<span class="${tokenEntry.c}">${tokenEntry.text}</span>` : tokenEntry.text).join("");
}

const cardMotion = { initial: { opacity: 0, y: 14, scale: 0.97, filter: "blur(4px)" }, animate: { opacity: 1, y: 0, scale: 1, filter: "blur(0px)" }, exit: { opacity: 0, y: -8, scale: 0.98, filter: "blur(2px)" } };
const cardTr = { duration: 0.4, ease: [0.16, 1, 0.3, 1] as const };

function CostBadge({ tokens, cost, inputTokens, outputTokens }: { tokens?: number; cost?: number; inputTokens?: number; outputTokens?: number }) {
  if (!tokens && !cost) return null;
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
}

const CONCEPT_DB: Record<string, { title: string; def: string }> = {
  "useState": { title: "React Hooks: State", def: "Declares a reactive state variable. Re-renders the component when the value changes." },
  "useEffect": { title: "React Hooks: Side Effects", def: "Runs code after render — used for subscriptions, data fetching, and DOM mutations." },
  "useCallback": { title: "React Hooks: Memoized Callback", def: "Returns a stable function reference to prevent unnecessary child re-renders." },
  "useMemo": { title: "React Hooks: Memoization", def: "Caches a computed value, recalculating only when dependencies change." },
  "useRef": { title: "React Hooks: Ref", def: "Holds a mutable value that persists across renders without triggering re-render." },
  "async": { title: "Async/Await", def: "Syntactic sugar over Promises, enabling sequential-looking asynchronous code." },
  "await": { title: "Async/Await", def: "Pauses execution until a Promise resolves, returning the unwrapped value." },
  "interface": { title: "TypeScript Interface", def: "Defines a contract for object shapes — enables compile-time type checking." },
  "type": { title: "TypeScript Type Alias", def: "Creates a named type that can represent unions, intersections, or complex shapes." },
  "Map": { title: "Hash Map (Map)", def: "Key-value store with O(1) average lookup. Preserves insertion order unlike plain objects." },
  "Set": { title: "Set (Unique Collection)", def: "Stores unique values with O(1) has/add/delete. Used for deduplication." },
  "Promise": { title: "Promise", def: "Represents an eventual value. Chains with .then() or unwraps with await." },
  "Socket": { title: "WebSocket (Socket.io)", def: "Persistent bidirectional connection for real-time server→client data push." },
  "AnimatePresence": { title: "Framer Motion: AnimatePresence", def: "Enables exit animations for components being removed from the React tree." },
  "motion": { title: "Framer Motion: motion", def: "Wraps elements with declarative animation props (initial, animate, exit)." },
  "middleware": { title: "Middleware Pattern", def: "Intercepts requests/responses in a pipeline. Common in Express, Redux, Next.js." },
  "debounce": { title: "Debouncing", def: "Delays execution until input stops for N ms. Prevents rapid-fire function calls." },
  "throttle": { title: "Throttling", def: "Limits execution to at most once per N ms. Ensures consistent update frequency." },
  "memoize": { title: "Memoization", def: "Caches function results for given inputs. Trades memory for CPU time." },
  "recursion": { title: "Recursion", def: "A function that calls itself with a smaller subproblem until a base case is reached." },
  "closure": { title: "Closure", def: "A function that captures variables from its outer scope, retaining access after the outer function returns." },
  "spawn": { title: "Child Process (spawn)", def: "Launches a new OS process. Returns streams for stdout/stderr piping." },
  "chokidar": { title: "File Watcher (chokidar)", def: "Cross-platform file system watcher. Emits events on file create/change/delete." },
  "Observable": { title: "Observable Pattern", def: "Push-based data stream. Subscribers receive values over time until completion." },
  "reducer": { title: "Reducer Pattern", def: "Pure function (state, action) → newState. Central to Redux and useReducer." },
  "context": { title: "React Context", def: "Provides values down the component tree without prop drilling." },
  "portal": { title: "React Portal", def: "Renders children into a different DOM node, useful for modals and overlays." },
  "generic": { title: "TypeScript Generics", def: "Parameterized types that enable type-safe reusable code (e.g., Array<T>)." },
  "extends": { title: "Inheritance / Constraint", def: "In classes: prototype chain. In generics: constrains T to a subtype." },
  "enum": { title: "TypeScript Enum", def: "Named set of constants. Compiles to a lookup object for bidirectional mapping." },
  "namespace": { title: "TypeScript Namespace", def: "Logical grouping of declarations. Avoids global scope pollution in large codebases." },
  "filter": { title: "Array.filter()", def: "Returns a new array containing only elements that pass the predicate test." },
  "reduce": { title: "Array.reduce()", def: "Accumulates array elements into a single value via a reducer function." },
  "useReducer": { title: "React Hooks: useReducer", def: "State management via (state, action) dispatch. Preferred over useState for complex state logic." },
  "useContext": { title: "React Hooks: useContext", def: "Reads a React Context value. Re-renders when the context provider updates." },
  "useLayoutEffect": { title: "React Hooks: useLayoutEffect", def: "Like useEffect but fires synchronously after DOM mutations, before paint." },
  "forwardRef": { title: "React: forwardRef", def: "Passes a ref through a component to a child DOM element or component." },
  "createPortal": { title: "React: createPortal", def: "Renders children into a DOM node outside the parent component hierarchy." },
  "Suspense": { title: "React: Suspense", def: "Displays a fallback while waiting for lazy-loaded components or async data." },
  "EventEmitter": { title: "Event Emitter", def: "Pub/sub pattern — objects emit named events and listeners react to them." },
  "fetch": { title: "Fetch API", def: "Browser-native HTTP client returning Promises. Replaces XMLHttpRequest." },
  "WebSocket": { title: "WebSocket", def: "Full-duplex TCP connection for real-time bidirectional communication." },
  "requestAnimationFrame": { title: "requestAnimationFrame", def: "Schedules a callback before the next repaint. Standard for smooth 60fps animations." },
  "IntersectionObserver": { title: "Intersection Observer", def: "Asynchronously observes element visibility changes. Used for lazy loading and infinite scroll." },
  "AbortController": { title: "AbortController", def: "Cancels in-flight fetch requests or other async operations via an abort signal." },
  "Symbol": { title: "Symbol (ES6)", def: "Unique, immutable primitive. Used as object property keys to avoid name collisions." },
  "Proxy": { title: "ES6 Proxy", def: "Intercepts and redefines fundamental operations (get, set, delete) on an object." },
  "WeakMap": { title: "WeakMap", def: "Key-value store where keys are weakly held — allows garbage collection of key objects." },
  "Generator": { title: "Generator Function", def: "Pausable function using yield. Returns an iterator for lazy value production." },
  "Iterator": { title: "Iterator Protocol", def: "An object with a next() method returning { value, done }. Powers for...of loops." },
};

interface DetectedConcept { key: string; title: string; def: string; firstCardId: string; }

function detectConceptsFromCards(cards: FeedCard[]): DetectedConcept[] {
  const found = new Map<string, string>();
  for (const card of cards) {
    const text = [card.text || "", card.code || "", card.diff?.added || "", card.diff?.removed || "", card.toolSummary || ""].join(" ");
    for (const key of Object.keys(CONCEPT_DB)) {
      if (!found.has(key) && text.includes(key)) {
        found.set(key, card.id);
      }
    }
  }
  return [...found.entries()].map(([key, firstCardId]) => ({ key, firstCardId, ...CONCEPT_DB[key] }));
}

function MentorTooltipPortal({ targetEl, term, onLearnMore, onClose }: {
  targetEl: HTMLElement | null; term: string; onLearnMore?: () => void; onClose: () => void;
}) {
  const [anchorPos, setAnchorPos] = useState({ cardRight: 0, cardTop: 0, kwY: 0, kwRight: 0 });
  const concept = term ? CONCEPT_DB[term] : null;

  useEffect(() => {
    if (!targetEl) return;
    const update = () => {
      const kwRect = targetEl.getBoundingClientRect();
      const card = targetEl.closest("[id^='card-']") as HTMLElement | null;
      const cardRect = card?.getBoundingClientRect();
      setAnchorPos({
        cardRight: cardRect ? cardRect.right : kwRect.right + 20,
        cardTop: cardRect ? cardRect.top : kwRect.top - 10,
        kwY: kwRect.top + kwRect.height / 2,
        kwRight: kwRect.right,
      });
    };
    update();
    window.addEventListener("scroll", update, true);
    return () => window.removeEventListener("scroll", update, true);
  }, [targetEl]);

  useEffect(() => {
    if (!targetEl) return;
    const card = targetEl.closest("[id^='card-']") as HTMLElement | null;
    const feed = document.querySelector("[data-feed]") as HTMLElement | null;
    if (feed) feed.setAttribute("data-tooltip-active", "true");
    if (card) card.setAttribute("data-tooltip-source", "true");
    return () => {
      if (feed) feed.removeAttribute("data-tooltip-active");
      if (card) card.removeAttribute("data-tooltip-source");
    };
  }, [targetEl]);

  if (!targetEl || !concept) return null;

  const panelW = 210;
  const sidebarLeft = (typeof window !== "undefined" ? window.innerWidth : 1400) - 181;
  const panelLeft = sidebarLeft - panelW;
  const panelTop = Math.max(45, Math.min(anchorPos.cardTop, (typeof window !== "undefined" ? window.innerHeight : 700) - 200));

  const source = concept.title.includes("React") ? "React Docs" : concept.title.includes("TypeScript") ? "TS Handbook" : concept.title.includes("Framer") ? "Framer API" : "Claude Analysis";

  return (
    <>
      <svg className="fixed z-[199] pointer-events-none inset-0 w-full h-full">
        <line x1={anchorPos.kwRight + 3} y1={anchorPos.kwY} x2={panelLeft} y2={panelTop + 20} stroke="rgba(129, 140, 248, 0.18)" strokeWidth="0.5" strokeDasharray="3 2">
          <animate attributeName="stroke-dashoffset" from="0" to="-5" dur="1.5s" repeatCount="indefinite" />
        </line>
        <circle cx={anchorPos.kwRight + 3} cy={anchorPos.kwY} r="1.5" fill="rgba(129, 140, 248, 0.35)" />
      </svg>

      <motion.div
        initial={{ opacity: 0, scale: 0.95, filter: "blur(10px)" }}
        animate={{ opacity: 1, scale: 1, filter: "blur(0px)" }}
        exit={{ opacity: 0, scale: 0.95, filter: "blur(6px)" }}
        transition={{ duration: 0.25, ease: [0.16, 1, 0.3, 1] }}
        onMouseLeave={onClose}
        className="fixed z-[200] rounded-l-xl border border-r-0 pointer-events-auto no-drag"
        style={{
          width: panelW,
          left: panelLeft,
          top: panelTop,
          background: "rgba(10, 10, 25, 0.85)",
          backdropFilter: "blur(40px) saturate(150%)",
          boxShadow: "-8px 4px 24px rgba(0,0,0,0.4), 0 0 12px rgba(99, 102, 241, 0.06)",
          borderColor: "rgba(129, 140, 248, 0.10)",
        }}
      >
        <div className="absolute left-0 top-3 bottom-3 w-[2px] rounded-full bg-indigo-400/25" />

        <div className="px-3.5 py-3 pl-4">
          <div className="flex items-center gap-1.5 mb-1.5">
            <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" className="text-indigo-400 shrink-0">
              <path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z" /><path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z" />
            </svg>
            <span className="text-[8px] font-sans font-bold tracking-wider uppercase text-indigo-300">{concept.title}</span>
          </div>

          <p className="text-[7px] font-sans font-bold text-indigo-300/25 mb-0.5 uppercase tracking-[0.18em]">{`What\u2019s happening here?`}</p>
          <p className="text-[9px] font-sans text-indigo-100/75 leading-[1.65] mb-2">{concept.def}</p>

          <div className="flex items-center gap-2 pointer-events-auto mb-2">
            {onLearnMore && (
              <button onClick={(e) => { e.stopPropagation(); onLearnMore(); }} className="flex items-center gap-1 text-[7px] font-sans font-bold tracking-[0.12em] uppercase text-indigo-400/70 hover:text-indigo-300 transition-colors cursor-pointer">
                <svg width="7" height="7" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" className="shrink-0"><path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z" /><path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z" /></svg>
                Knowledge Bank
              </button>
            )}
          </div>

          <div className="flex items-center justify-between border-t border-white/[0.04] pt-1.5">
            <span className="text-[6px] font-mono text-txt-tertiary/40">[{source}]</span>
            <div className="flex items-center gap-0.5">
              <span className="text-[6px] font-sans font-black text-txt-tertiary/30">M</span>
              <span className="text-[6px] font-sans font-light text-indigo-400/25">Scope</span>
            </div>
          </div>
        </div>
      </motion.div>
    </>
  );
}

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

function MentorTerm({ term, children, onLearnMore }: { term: string; children: React.ReactNode; onLearnMore?: () => void }) {
  const [show, setShow] = useState(false);
  const concept = CONCEPT_DB[term];
  if (!concept) return <>{children}</>;

  return (
    <span className="relative inline-block" onMouseEnter={() => setShow(true)} onMouseLeave={() => setShow(false)}>
      <span className="border-b border-dotted border-indigo-400/30 cursor-help text-indigo-300/80">{children}</span>
      <AnimatePresence>
        {show && (
          <motion.div
            initial={{ opacity: 0, y: 4, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 4, scale: 0.97 }}
            transition={{ duration: 0.15 }}
            className="absolute z-50 bottom-full left-0 mb-2 w-60 rounded-xl border border-indigo-400/15 overflow-hidden"
            style={{ background: "rgba(8, 8, 20, 0.92)", backdropFilter: "blur(30px)", boxShadow: "0 12px 32px rgba(0,0,0,0.6)" }}
          >
            <div className="absolute -bottom-1 left-4 w-2 h-2 rotate-45 border-r border-b border-indigo-400/15" style={{ background: "rgba(8, 8, 20, 0.92)" }} />
            <div className="px-3 py-2.5">
              <div className="flex items-center gap-1.5 mb-1.5">
                <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" className="text-indigo-400/70 shrink-0">
                  <path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z" /><path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z" />
                </svg>
                <span className="text-[8px] font-sans font-bold tracking-wider uppercase text-indigo-300/90">{concept.title}</span>
              </div>
              <p className="text-[8px] font-sans font-semibold text-indigo-200/50 mb-1 uppercase tracking-wider">What{"\u2019"}s happening here?</p>
              <p className="text-[9px] font-sans text-indigo-200/80 leading-[1.6] mb-2">{concept.def}</p>
              {onLearnMore && (
                <button onClick={onLearnMore} className="text-[7px] font-sans font-bold tracking-[0.15em] uppercase text-indigo-400/70 hover:text-indigo-300 transition-colors">
                  Open Knowledge Bank {"\u2192"}
                </button>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </span>
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
    setTimeout(() => setCopied(false), 1500);
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

function CodeLines({ code, maxLines, showLineNums, startLine = 1, isNewFile, onLearnMore }: { code: string; maxLines: number; showLineNums: boolean; startLine?: number; isNewFile?: boolean; onLearnMore?: () => void }) {
  const lines = code.split("\n");
  const display = lines.slice(0, maxLines);
  const maxLineNum = startLine + Math.min(lines.length, maxLines) - 1;
  const gutterW = String(maxLineNum).length;
  const [hoveredEl, setHoveredEl] = useState<{ el: HTMLElement; term: string } | null>(null);
  const enterTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const leaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

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

function DiffLines({ removed, added, maxLines, showLineNums, startLine = 1, onLearnMore }: { removed: string; added: string; maxLines: number; showLineNums: boolean; startLine?: number; onLearnMore?: () => void }) {
  const rmLines = removed.split("\n");
  const adLines = added.split("\n");
  const rmShow = rmLines.slice(0, Math.min(rmLines.length, Math.ceil(maxLines / 2)));
  const adShow = adLines.slice(0, Math.min(adLines.length, Math.floor(maxLines / 2)));
  const maxLineNum = startLine + Math.max(rmLines.length, adLines.length) - 1;
  const gutterW = String(maxLineNum).length;
  const [hoveredEl, setHoveredEl] = useState<{ el: HTMLElement; term: string } | null>(null);
  const enterTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const leaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

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

function DiffModal({ card, onClose }: { card: FeedCard; onClose: () => void }) {
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

function Timestamp({ ts }: { ts: string }) { if (!ts) return null; return <span className="text-[8px] font-mono text-txt-tertiary ml-auto tabular-nums">{new Date(ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })}</span>; }
function AgentBadge({ id }: { id: string }) { return <span className="text-[7px] font-mono px-1 py-0.5 rounded bg-indigo-500/20 text-indigo-300/70">{id.slice(0, 7)}</span>; }

function CardRouter({ card, onLearnMore }: { card: FeedCard; onLearnMore?: () => void }) {
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
}

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

function cleanProjectName(raw: string): string {
  return raw
    .replace(/^C--Users-[^-]+-/, "")
    .replace(/-/g, "/");
}

function relativeTime(isoStr: string | null): string {
  if (!isoStr) return "never";
  const diff = Date.now() - new Date(isoStr).getTime();
  if (diff < 60_000) return "just now";
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`;
  return `${Math.floor(diff / 86_400_000)}d ago`;
}

function LeftSidebar({ projects, activeProjectId, onSelect, cards, onJumpToCard, onSetTab, fileTargets }: { projects: ProjectInfo[]; activeProjectId: string | null; onSelect: (id: string) => void; cards: FeedCard[]; onJumpToCard: (cardId: string) => void; onSetTab?: (setter: (tab: "projects" | "knowledge") => void) => void; fileTargets?: Record<string, string> }) {
  const [tab, setTab] = useState<"projects" | "knowledge">("projects");
  const [search, setSearch] = useState("");

  const filtered = useMemo(() => {
    if (!search.trim()) return projects;
    const q = search.toLowerCase();
    return projects.filter(p => cleanProjectName(p.name).toLowerCase().includes(q) || p.name.toLowerCase().includes(q));
  }, [projects, search]);

  const knowledgeBank = useMemo(() => detectConceptsFromCards(cards), [cards]);

  useEffect(() => { if (onSetTab) onSetTab(setTab); }, [onSetTab]);

  return (
    <div className="w-full h-full flex flex-col overflow-hidden"
         style={{ background: "var(--sidebar-bg)", backdropFilter: "blur(50px) saturate(160%)" }}>

      <div className="flex items-center border-b border-white/[0.06] shrink-0">
        <button onClick={() => setTab("projects")}
          className={`flex-1 flex items-center justify-center gap-1.5 py-2.5 transition-colors ${tab === "projects" ? "text-txt-primary border-b border-cyan-400/60" : "text-txt-tertiary hover:text-txt-secondary"}`}>
          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
          </svg>
          <span className="text-[8px] font-sans font-semibold tracking-[0.15em] uppercase">Projects</span>
        </button>
        <button onClick={() => setTab("knowledge")}
          className={`flex-1 flex items-center justify-center gap-1.5 py-2.5 transition-colors ${tab === "knowledge" ? "text-indigo-300 border-b border-indigo-400/60" : "text-txt-tertiary hover:text-txt-secondary"}`}>
          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            <path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z" /><path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z" />
          </svg>
          <span className="text-[8px] font-sans font-semibold tracking-[0.15em] uppercase">Learn</span>
          {knowledgeBank.length > 0 && <span className="text-[7px] font-mono bg-indigo-500/20 text-indigo-300/80 px-1 py-0.5 rounded-full leading-none">{knowledgeBank.length}</span>}
        </button>
      </div>

      <AnimatePresence mode="wait">
        {tab === "projects" && (
          <motion.div key="projects" initial={{ opacity: 0, x: -10 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -10 }} transition={{ duration: 0.2 }} className="flex-1 flex flex-col min-h-0">
            <div className="px-2.5 pt-2.5 pb-2 shrink-0">
              <input type="text" value={search} onChange={e => setSearch(e.target.value)} placeholder="Search projects..."
                className="w-full px-2.5 py-1.5 rounded-md text-[9px] font-mono text-txt-secondary placeholder:text-txt-tertiary outline-none transition-colors"
                style={{ background: "rgba(255, 255, 255, 0.03)", border: "1px solid rgba(255, 255, 255, 0.08)" }}
                onFocus={e => { e.target.style.borderColor = "rgba(255, 255, 255, 0.15)"; }}
                onBlur={e => { e.target.style.borderColor = "rgba(255, 255, 255, 0.08)"; }}
              />
            </div>
            <div className="flex-1 overflow-y-auto px-1.5 pb-2">
              {filtered.length === 0 && <p className="text-[8px] font-mono text-txt-tertiary text-center mt-4">No projects found</p>}
              {filtered.map(proj => {
                const isActive = proj.id === activeProjectId;
                return (
                  <button key={proj.id} onClick={() => onSelect(proj.id)}
                    className={`w-full text-left px-2 py-2 rounded-md mb-0.5 transition-all duration-150 group ${isActive ? "bg-white/[0.06] border-l-2 border-l-cyan-400/60" : "hover:bg-white/[0.04] border-l-2 border-l-transparent"}`}>
                    <div className="flex items-center gap-1.5 min-w-0">
                      {proj.isLive && <div className="w-[5px] h-[5px] rounded-full bg-emerald-400 animate-live-pulse shrink-0" />}
                      <span className={`text-[8.5px] font-mono truncate block ${isActive ? "text-txt-primary" : "text-txt-secondary group-hover:text-txt-primary"}`}>{cleanProjectName(proj.name)}</span>
                    </div>
                    <div className="flex items-center gap-1.5 mt-0.5">
                      <span className="text-[7.5px] font-sans text-txt-tertiary">{relativeTime(proj.lastActive)}</span>
                      <span className="text-[7px] font-mono text-txt-tertiary">{proj.sessionCount}s</span>
                    </div>
                  </button>
                );
              })}
            </div>
          </motion.div>
        )}
        {tab === "knowledge" && (
          <motion.div key="knowledge" initial={{ opacity: 0, x: 10 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: 10 }} transition={{ duration: 0.2 }} className="flex-1 overflow-y-auto px-2.5 pt-3 pb-2">
            {knowledgeBank.length === 0 ? (
              <div className="text-center mt-6">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="mx-auto text-indigo-400/30 mb-2">
                  <path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z" /><path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z" />
                </svg>
                <p className="text-[9px] font-sans text-txt-tertiary">Concepts appear as code is written</p>
              </div>
            ) : (
              <div className="space-y-2">
                <p className="text-[7px] font-sans font-semibold tracking-[0.2em] uppercase text-indigo-400/40 mb-2">Concepts Introduced ({knowledgeBank.length})</p>
                {knowledgeBank.map(concept => (
                  <button key={concept.key} onClick={() => onJumpToCard(concept.firstCardId)}
                    className="w-full text-left px-2 py-2 rounded-md bg-indigo-500/[0.05] border border-indigo-400/[0.08] hover:bg-indigo-500/[0.10] hover:border-indigo-400/[0.15] transition-colors cursor-pointer group">
                    <div className="flex items-center gap-1.5 mb-1">
                      <svg width="8" height="8" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" className="text-indigo-400/60 shrink-0">
                        <path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z" /><path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z" />
                      </svg>
                      <span className="text-[8px] font-sans font-bold tracking-wider uppercase text-indigo-300/90">{concept.title}</span>
                      <svg width="8" height="8" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="ml-auto text-indigo-400/30 group-hover:text-indigo-400/70 transition-colors shrink-0">
                        <path d="M9 5l7 7-7 7" />
                      </svg>
                    </div>
                    <p className="text-[8px] font-sans text-indigo-200/60 leading-[1.6]">{concept.def}</p>
                    <span className="text-[7px] font-mono text-indigo-400/30 mt-0.5 block">{concept.key}</span>
                  </button>
                ))}
              </div>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

interface DirEntry { name: string; path: string; type: "file" | "dir"; ext?: string; lines?: number; children?: DirEntry[]; }
interface MapNode { id: string; name: string; ext: string; type: "file" | "dir"; lines: number; x: number; y: number; parentDir: string; }
interface MapEdge { from: string; to: string; edgeType?: string; }

const extColor = (ext: string) => {
  if (ext === "tsx" || ext === "ts") return "#7dd3fc";
  if (ext === "js" || ext === "mjs") return "#fbbf24";
  if (ext === "css") return "#c084fc";
  if (ext === "json") return "#6ee7b7";
  if (ext === "md") return "#94a3b8";
  return "#64748b";
};

function flattenTree(entries: DirEntry[], parent = ""): MapNode[] {
  const nodes: MapNode[] = [];
  entries.forEach((e, i) => {
    const angle = (i / entries.length) * Math.PI * 2;
    const radius = parent ? 35 : 65;
    const centerX = parent ? 0 : 200;
    const centerY = parent ? 0 : 200;
    nodes.push({ id: e.path, name: e.name, ext: e.ext || "", type: e.type, lines: e.lines || 0, x: centerX + Math.cos(angle) * radius, y: centerY + Math.sin(angle) * radius, parentDir: parent });
    if (e.type === "dir" && e.children) {
      nodes.push(...flattenTree(e.children, e.path));
    }
  });
  return nodes;
}

function LogicMap({ cards, fileTargets, onJumpToCard }: { cards: FeedCard[]; fileTargets: Record<string, string>; onJumpToCard: (cardId: string) => void }) {
  const [tree, setTree] = useState<DirEntry[]>([]);
  const [rootName, setRootName] = useState("");
  const [hoveredNode, setHoveredNode] = useState<string | null>(null);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const [zoom, setZoom] = useState(1);
  const [dragging, setDragging] = useState(false);
  const dragStart = useRef({ x: 0, y: 0, ox: 0, oy: 0 });
  const [depEdges, setDepEdges] = useState<MapEdge[]>([]);
  const [depsLayer, setDepsLayer] = useState(true);
  const [activityLayer, setActivityLayer] = useState(false);
  const [flowLayer, setFlowLayer] = useState(false);

  const recentFiles = useMemo(() => {
    const recent = new Set<string>();
    const lastCards = cards.slice(-15);
    for (const cardItem of lastCards) { if (cardItem.filename) recent.add(cardItem.filename); }
    return recent;
  }, [cards]);

  const fetchTree = useCallback(() => {
    fetch("http://localhost:3778/scan-directory")
      .then(response => response.json())
      .then(data => { setTree(data.tree || []); setRootName(data.root || "project"); })
      .catch(() => {});
  }, []);

  useEffect(() => { fetchTree(); }, [fetchTree]);

  useEffect(() => {
    fetch("http://localhost:3778/scan-dependencies")
      .then(r => r.json())
      .then(data => {
        const edges: MapEdge[] = (data.edges || []).map((e: { from: string; to: string; edgeType?: string }) => ({
          from: e.from, to: e.to, edgeType: e.edgeType,
        }));
        setDepEdges(edges);
      })
      .catch(() => {});
  }, []);

  const { nodes, edges } = useMemo(() => {
    const flat = flattenTree(tree);
    if (flat.length === 0) return { nodes: [], edges: [] };

    const edgeList: MapEdge[] = [];
    for (const n of flat) {
      if (n.parentDir) edgeList.push({ from: n.parentDir, to: n.id });
    }

    const dirNodes = flat.filter(n => n.type === "dir" && !n.parentDir);
    const cx = 200, cy = 200;

    dirNodes.forEach((d, i) => {
      const angle = (i / Math.max(dirNodes.length, 1)) * Math.PI * 2 - Math.PI / 2;
      const radius = 80 + dirNodes.length * 8;
      d.x = cx + Math.cos(angle) * radius;
      d.y = cy + Math.sin(angle) * radius;
    });

    for (const dir of flat.filter(n => n.type === "dir")) {
      const children = flat.filter(n => n.parentDir === dir.id);
      children.forEach((child, i) => {
        const angle = (i / Math.max(children.length, 1)) * Math.PI * 2;
        const radius = 20 + children.length * 3;
        child.x = dir.x + Math.cos(angle) * radius;
        child.y = dir.y + Math.sin(angle) * radius;
      });
    }

    const rootFiles = flat.filter(n => n.type === "file" && !n.parentDir);
    rootFiles.forEach((f, i) => {
      const angle = (i / Math.max(rootFiles.length, 1)) * Math.PI * 2;
      f.x = cx + Math.cos(angle) * 30;
      f.y = cy + Math.sin(angle) * 30;
    });

    const visible = flat.filter(n => {
      if (!n.parentDir) return true;
      let parent = n.parentDir;
      while (parent) {
        if (collapsed.has(parent)) return false;
        const pNode = flat.find(nn => nn.id === parent);
        parent = pNode?.parentDir || "";
      }
      return true;
    });

    const visibleIds = new Set(visible.map(n => n.id));
    const visibleEdges = edgeList.filter(e => visibleIds.has(e.from) && visibleIds.has(e.to));

    return { nodes: visible, edges: visibleEdges };
  }, [tree, collapsed]);

  const incomingCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const e of depEdges) {
      counts[e.to] = (counts[e.to] || 0) + 1;
    }
    return counts;
  }, [depEdges]);

  const handleMouseDown = useCallback((e: React.MouseEvent) => { setDragging(true); dragStart.current = { x: e.clientX, y: e.clientY, ox: offset.x, oy: offset.y }; }, [offset]);
  const handleMouseMove = useCallback((e: React.MouseEvent) => { if (!dragging) return; setOffset({ x: dragStart.current.ox + (e.clientX - dragStart.current.x), y: dragStart.current.oy + (e.clientY - dragStart.current.y) }); }, [dragging]);
  const handleMouseUp = useCallback(() => setDragging(false), []);
  const handleWheel = useCallback((e: React.WheelEvent) => { setZoom(z => Math.max(0.3, Math.min(3, z + (e.deltaY > 0 ? -0.1 : 0.1)))); }, []);

  const toggleCollapse = useCallback((id: string) => {
    setCollapsed(prev => { const next = new Set(prev); if (next.has(id)) next.delete(id); else next.add(id); return next; });
  }, []);

  if (nodes.length === 0) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="text-center space-y-2">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="mx-auto text-cyan-400/20">
            <circle cx="6" cy="6" r="2" /><circle cx="18" cy="18" r="2" /><line x1="8" y1="8" x2="16" y2="16" />
          </svg>
          <p className="text-[8px] font-sans text-txt-tertiary">Loading directory...</p>
          <button onClick={fetchTree} className="text-[7px] font-mono text-indigo-400/60 hover:text-indigo-400 transition-colors">Refresh</button>
        </div>
      </div>
    );
  }

  const hovered = hoveredNode ? nodes.find(n => n.id === hoveredNode) : null;
  const minX = Math.min(...nodes.map(n => n.x)) - 30;
  const minY = Math.min(...nodes.map(n => n.y)) - 30;
  const maxX = Math.max(...nodes.map(n => n.x)) + 30;
  const maxY = Math.max(...nodes.map(n => n.y)) + 30;

  return (
    <div className="w-full h-full relative overflow-hidden cursor-grab active:cursor-grabbing"
         onMouseDown={handleMouseDown} onMouseMove={handleMouseMove} onMouseUp={handleMouseUp} onMouseLeave={handleMouseUp} onWheel={handleWheel}>

      <svg viewBox={`${minX} ${minY} ${maxX - minX} ${maxY - minY}`} className="w-full h-full"
           style={{ transform: `translate(${offset.x}px, ${offset.y}px) scale(${zoom})`, transformOrigin: "center" }}>

        {nodes.filter(n => n.type === "dir").map(dir => {
          const children = nodes.filter(n => n.parentDir === dir.id);
          if (children.length === 0) return null;
          const cxs = [dir.x, ...children.map(c => c.x)];
          const cys = [dir.y, ...children.map(c => c.y)];
          const clX = Math.min(...cxs) - 12, clY = Math.min(...cys) - 12;
          const clW = Math.max(...cxs) - clX + 24, clH = Math.max(...cys) - clY + 24;
          return <rect key={`cluster-${dir.id}`} x={clX} y={clY} width={clW} height={clH} rx="6" fill="rgba(99, 102, 241, 0.03)" stroke="rgba(99, 102, 241, 0.08)" strokeWidth="0.5" />;
        })}

        <defs>
          <marker id="arrow-import" viewBox="0 0 10 10" refX="10" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
            <path d="M 0 0 L 10 5 L 0 10 z" fill="rgba(129, 140, 248, 0.4)" />
          </marker>
          <marker id="arrow-require" viewBox="0 0 10 10" refX="10" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
            <path d="M 0 0 L 10 5 L 0 10 z" fill="rgba(34, 211, 238, 0.4)" />
          </marker>
          <marker id="arrow-css" viewBox="0 0 10 10" refX="10" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
            <path d="M 0 0 L 10 5 L 0 10 z" fill="rgba(192, 132, 252, 0.4)" />
          </marker>
        </defs>

        {(depsLayer ? depEdges : edges).map((edge, i) => {
          const a = nodes.find(n => n.id === edge.from);
          const b = nodes.find(n => n.id === edge.to);
          if (!a || !b) return null;
          const isHovered = hoveredNode === edge.from || hoveredNode === edge.to;
          if (depsLayer) {
            const mx = (a.x + b.x) / 2 + (a.y - b.y) * 0.15;
            const my = (a.y + b.y) / 2 + (b.x - a.x) * 0.15;
            const color = edge.edgeType === "require" ? "rgba(34, 211, 238, 0.3)" : edge.edgeType === "css-import" ? "rgba(192, 132, 252, 0.3)" : "rgba(129, 140, 248, 0.3)";
            const markerId = edge.edgeType === "require" ? "arrow-require" : edge.edgeType === "css-import" ? "arrow-css" : "arrow-import";
            return <path key={`dep-${i}`} d={`M${a.x},${a.y} Q${mx},${my} ${b.x},${b.y}`} fill="none" stroke={color} strokeWidth={isHovered ? 1.2 : 0.5} opacity={isHovered ? 1 : 0.5} markerEnd={`url(#${markerId})`} />;
          }
          return <line key={i} x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke="rgba(129, 140, 248, 0.12)" strokeWidth="0.5" />;
        })}

        {nodes.map(node => {
          const isDir = node.type === "dir";
          const isHov = hoveredNode === node.id;
          const isRecent = recentFiles.has(node.id) || recentFiles.has(node.name);
          const target = fileTargets[node.id] || fileTargets[node.name] || "neutral";
          const isSniped = target === "snipe";
          const isFocus = target === "focus";
          const inc = incomingCounts[node.id] || 0;
          const nodeRadius = isDir ? 8 : Math.min(5 + inc * 1.5, 14);
          const stroke = isDir ? "rgba(255,255,255,0.15)" : extColor(node.ext);

          return (
            <g key={node.id}
               onMouseEnter={() => setHoveredNode(node.id)} onMouseLeave={() => setHoveredNode(null)}
               onClick={(e) => { e.stopPropagation(); if (isDir) toggleCollapse(node.id); else { const card = cards.find(c => c.filename === node.name || c.filename === node.id); if (card) onJumpToCard(card.id); } }}
               className="cursor-pointer">
              {(isRecent || isFocus) && <circle cx={node.x} cy={node.y} r={nodeRadius + 4} fill={isFocus ? "rgba(251,191,36,0.15)" : "rgba(129,140,248,0.15)"} opacity="0.8">
                <animate attributeName="r" values={`${nodeRadius + 3};${nodeRadius + 6};${nodeRadius + 3}`} dur="2.5s" repeatCount="indefinite" />
              </circle>}
              <circle cx={node.x} cy={node.y} r={nodeRadius} fill={isDir ? "rgba(30,32,45,0.9)" : "rgba(20,22,30,0.85)"}
                stroke={isHov ? "#818cf8" : stroke} strokeWidth={isHov ? 1.2 : 0.6} opacity={isSniped ? 0.2 : 1} />
              {isDir && collapsed.has(node.id) && <text x={node.x} y={node.y + 2} textAnchor="middle" className="text-[4px]" fill="rgba(255,255,255,0.3)">+</text>}
              {!isDir && <text x={node.x} y={node.y + 1.5} textAnchor="middle" className="text-[2.5px] font-mono font-bold" fill={extColor(node.ext)}>{node.ext.toUpperCase()}</text>}
              <text x={node.x} y={node.y + nodeRadius + 6} textAnchor="middle" className={`font-mono ${isDir ? "text-[3.5px] font-bold" : "text-[3px]"}`}
                fill={isSniped ? "rgba(255,255,255,0.15)" : isDir ? "rgba(255,255,255,0.5)" : "rgba(255,255,255,0.35)"}>
                {node.name.length > 16 ? node.name.slice(0, 14) + ".." : node.name}
              </text>
              {isSniped && <line x1={node.x - nodeRadius} y1={node.y} x2={node.x + nodeRadius} y2={node.y} stroke="rgba(248,113,113,0.5)" strokeWidth="0.5" />}
            </g>
          );
        })}
      </svg>

      {hovered && (
        <div className="absolute bottom-2 left-2 right-2 px-2.5 py-2 rounded-lg pointer-events-none"
             style={{ background: "rgba(10,10,25,0.92)", border: "1px solid rgba(255,255,255,0.06)" }}>
          <div className="flex items-center gap-1.5 mb-1">
            {hovered.type === "dir"
              ? <svg width="8" height="8" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-txt-secondary shrink-0"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" /></svg>
              : <span className="w-2 h-2 rounded-full shrink-0" style={{ background: extColor(hovered.ext) }} />}
            <span className="text-[8px] font-mono text-txt-primary">{hovered.id}</span>
          </div>
          <div className="flex items-center gap-3 text-[7px] font-mono text-txt-tertiary">
            {hovered.type === "file" && <span>{hovered.lines}L</span>}
            {hovered.type === "dir" && <span>{collapsed.has(hovered.id) ? "collapsed" : "expanded"}</span>}
            {recentFiles.has(hovered.id) && <span className="text-indigo-400/70">active</span>}
            {(fileTargets[hovered.id] || fileTargets[hovered.name]) === "focus" && <span className="text-amber-400">FOCUS</span>}
            {(fileTargets[hovered.id] || fileTargets[hovered.name]) === "snipe" && <span className="text-red-400/60">SNIPED</span>}
          </div>
        </div>
      )}

      <div className="absolute top-2 right-2 flex items-center gap-1">
        {[
          { id: "deps", label: "DEPS", active: depsLayer, toggle: () => setDepsLayer(v => !v) },
          { id: "activity", label: "ACTIVITY", active: activityLayer, toggle: () => setActivityLayer(v => !v) },
          { id: "flow", label: "FLOW", active: flowLayer, toggle: () => setFlowLayer(v => !v) },
        ].map(btn => (
          <button key={btn.id} onClick={btn.toggle}
            className={`px-2 py-1 rounded-md text-[7px] font-sans font-bold tracking-[0.15em] uppercase transition-all ${btn.active ? "bg-indigo-500/25 text-white" : "bg-white/[0.04] text-txt-tertiary hover:text-txt-secondary"}`}>
            {btn.label}
          </button>
        ))}
        <button onClick={fetchTree} className="w-6 h-6 flex items-center justify-center rounded-md bg-white/[0.04] hover:bg-white/[0.08] text-txt-tertiary hover:text-indigo-400 transition-colors" title="Refresh">
          <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><polyline points="23 4 23 10 17 10" /><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10" /></svg>
        </button>
      </div>

      <div className="absolute top-2 left-2 flex gap-2 text-[6px] font-mono text-txt-tertiary pointer-events-none">
        <span className="flex items-center gap-1"><span className="w-1.5 h-1.5 rounded-full" style={{ background: "#7dd3fc" }} />TS</span>
        <span className="flex items-center gap-1"><span className="w-1.5 h-1.5 rounded-full" style={{ background: "#fbbf24" }} />JS</span>
        <span className="flex items-center gap-1"><span className="w-1.5 h-1.5 rounded-full" style={{ background: "#c084fc" }} />CSS</span>
        <span className="flex items-center gap-1"><span className="w-1.5 h-1.5 rounded-full" style={{ background: "#6ee7b7" }} />JSON</span>
      </div>
    </div>
  );
}

const HOURLY_CAP = 60;

function Sidebar({ metrics, model, session, onReset, fileTargets, onCycleTarget, snipedCount, hardwareMetrics }: { metrics: Metrics; model: string; session: SessionInfo | null; onReset?: () => void; fileTargets?: Record<string, string>; onCycleTarget?: (file: string) => void; snipedCount?: number; hardwareMetrics?: HwMetrics | null }) {
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
}

function ProgressBar({ value, detail }: { value: number; detail: string }) {
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

function SideMetric({ icon, label, value, color, pulse }: { icon: React.ReactNode; label: string; value: string; color: string; pulse?: boolean }) {
  return (<div className={`flex items-center gap-2.5 ${pulse ? "animate-pulse" : ""}`}><span className={`${color} opacity-50 shrink-0`}>{icon}</span><div className="flex-1 min-w-0"><span className="text-[8px] font-sans font-semibold tracking-[0.18em] uppercase text-txt-tertiary block leading-none">{label}</span><span className={`text-[12px] font-mono font-bold leading-tight tabular-nums ${color} block mt-0.5`}>{value}</span></div></div>);
}

function CpuIcon() { return <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><rect x="4" y="4" width="16" height="16" rx="2" /><rect x="9" y="9" width="6" height="6" /><line x1="9" y1="1" x2="9" y2="4" /><line x1="15" y1="1" x2="15" y2="4" /><line x1="9" y1="20" x2="9" y2="23" /><line x1="15" y1="20" x2="15" y2="23" /><line x1="20" y1="9" x2="23" y2="9" /><line x1="20" y1="14" x2="23" y2="14" /><line x1="1" y1="9" x2="4" y2="9" /><line x1="1" y1="14" x2="4" y2="14" /></svg>; }
function ZapIcon() { return <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" /></svg>; }
function DollarIcon() { return <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><line x1="12" y1="1" x2="12" y2="23" /><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6" /></svg>; }
function ClockIcon() { return <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><circle cx="12" cy="12" r="10" /><polyline points="12 6 12 12 16 14" /></svg>; }
function LayersIcon() { return <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><polygon points="12 2 2 7 12 12 22 7 12 2" /><polyline points="2 17 12 22 22 17" /><polyline points="2 12 12 17 22 12" /></svg>; }
function WrenchIcon() { return <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z" /></svg>; }

interface HudSettings {
  glassOpacity: number;
  blurIntensity: "none" | "low" | "high";
  sidebarShadows: boolean;
  hotspotsEnabled: boolean;
  rationaleAutoExpand: boolean;
  tooltipDelay: number;
  sessionBudget: number;
  inputRate: number;
  outputRate: number;
  alwaysOnTop: boolean;
  simpleHotspots: boolean;
  autoSnipeLargeFiles: boolean;
}

const DEFAULT_SETTINGS: HudSettings = {
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

function useSettings(): [HudSettings, (patch: Partial<HudSettings>) => void, () => void] {
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

function SettingsModal({ settings, onUpdate, onReset, onClose }: {
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

function CommandBar() {
  const [input, setInput] = useState("");
  const [response, setResponse] = useState("");
  const [rawOutput, setRawOutput] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState("idle");
  const [lastPrompt, setLastPrompt] = useState("");
  const [showRaw, setShowRaw] = useState(false);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const responseRef = useRef<HTMLDivElement>(null);

  type CmdAPI = {
    sendPrompt: (t: string) => void;
    sendToTerminal: (t: string) => void;
    cancelCommand: () => void;
    onPromptResponse: (cb: (d: { type: string; data?: string }) => void) => void;
    removePromptResponse: () => void;
    onFocusInput: (cb: () => void) => void;
    removeFocusInput: () => void;
    onStatusChange: (cb: (s: string) => void) => void;
    removeStatusChange: () => void;
  };

  const getApi = () => (window as unknown as Record<string, CmdAPI>).electronAPI;

  useEffect(() => {
    const api = getApi();
    if (!api) return;

    api.onFocusInput(() => { inputRef.current?.focus(); });
    api.onStatusChange((s) => { setStatus(s); });

    api.onPromptResponse((msg) => {
      if (msg.type === "start") {
        setResponse("");
        setRawOutput("");
        setError("");
        setLoading(true);
      } else if (msg.type === "chunk") {
        setResponse(prev => prev + (msg.data || ""));
      } else if (msg.type === "raw") {
        setRawOutput(prev => prev + (msg.data || ""));
      } else if (msg.type === "error") {
        setError(prev => prev + (msg.data || ""));
      } else if (msg.type === "done") {
        setLoading(false);
        inputRef.current?.focus();
      }
    });

    return () => {
      api.removePromptResponse();
      api.removeFocusInput();
      api.removeStatusChange();
    };
  }, []);

  useEffect(() => {
    if (responseRef.current) {
      responseRef.current.scrollTop = responseRef.current.scrollHeight;
    }
  }, [response, rawOutput, error]);

  const resizeTextarea = useCallback(() => {
    const el = inputRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = Math.min(el.scrollHeight, 300) + "px";
  }, []);

  useEffect(() => { resizeTextarea(); }, [input, resizeTextarea]);

  const send = () => {
    const text = input.trim();
    if (!text) return;
    const api = getApi();
    if (!api) return;

    if (isPermission) {
      api.sendToTerminal(text);
      setInput("");
      setStatus("streaming");
      if (inputRef.current) inputRef.current.style.height = "auto";
      return;
    }

    if (loading) return;
    setResponse("");
    setRawOutput("");
    setError("");
    setLastPrompt(text);
    api.sendPrompt(text);
    setInput("");
    if (inputRef.current) inputRef.current.style.height = "auto";
  };

  const sendTerminal = (text: string) => {
    const api = getApi();
    if (!api) return;
    api.sendToTerminal(text);
    setStatus("streaming");
  };

  const cancel = () => {
    const api = getApi();
    if (!api) return;
    api.cancelCommand();
    setStatus("idle");
    inputRef.current?.blur();
  };

  const isThinking = status === "thinking";
  const isStreaming = status === "streaming";
  const isPermission = status === "permission";
  const displayContent = showRaw ? rawOutput : response;
  const barClass = isPermission ? "cmd-permission" : isThinking ? "cmd-thinking" : "";

  return (
    <div className={`no-drag shrink-0 border-t border-white/[0.08] transition-all duration-300 ${barClass}`} style={{ background: "rgba(0, 0, 0, 0.40)", backdropFilter: "blur(24px) saturate(150%)" }}>
      {(displayContent || error || loading) && (
        <div ref={responseRef} className="px-3 pt-2 pb-1 max-h-[150px] overflow-y-auto">
          {lastPrompt && (
            <div className="flex items-center gap-1.5 mb-1.5">
              <span className="text-[7px] font-sans font-bold tracking-[0.15em] uppercase text-indigo-400/50">PROMPT</span>
              <span className="text-[9px] font-mono text-txt-tertiary truncate">{lastPrompt}</span>
            </div>
          )}
          {displayContent && (
            showRaw
              ? <pre className="text-[8px] font-mono text-cyan-300/50 leading-relaxed whitespace-pre-wrap break-all">{displayContent}</pre>
              : <p className="text-[9px] font-mono text-indigo-200/70 leading-relaxed whitespace-pre-wrap">{displayContent}</p>
          )}
          {error && <p className="text-[9px] font-mono text-red-400/70 leading-relaxed whitespace-pre-wrap">{error}</p>}
          {isThinking && !displayContent && !error && (
            <div className="flex items-center gap-2 py-1">
              <div className="w-2.5 h-2.5 rounded-full border border-cyan-400/50 border-t-cyan-400 animate-spin" />
              <span className="text-[8px] font-mono text-cyan-300/50">Thinking...</span>
            </div>
          )}
          {isStreaming && loading && (
            <div className="flex items-center gap-1 mt-1">
              <div className="w-1.5 h-1.5 rounded-full bg-indigo-400/60 animate-pulse" />
            </div>
          )}
        </div>
      )}
      {isPermission && (
        <div className="flex items-center gap-2 px-3 py-1.5 border-t border-amber-400/10">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-amber-400/70 shrink-0">
            <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" /><line x1="12" y1="9" x2="12" y2="13" /><line x1="12" y1="17" x2="12.01" y2="17" />
          </svg>
          <span className="text-[8px] font-sans font-bold tracking-[0.12em] uppercase text-amber-300/70">Permission Required</span>
          <div className="flex-1" />
          <button onClick={() => sendTerminal("y")}
            className="px-2.5 py-1 rounded-md text-[8px] font-sans font-bold tracking-wider uppercase transition-all"
            style={{ background: "rgba(74, 222, 128, 0.15)", border: "1px solid rgba(74, 222, 128, 0.20)", color: "rgba(134, 239, 172, 0.9)" }}>
            Approve
          </button>
          <button onClick={() => sendTerminal("n")}
            className="px-2.5 py-1 rounded-md text-[8px] font-sans font-bold tracking-wider uppercase transition-all"
            style={{ background: "rgba(239, 68, 68, 0.15)", border: "1px solid rgba(239, 68, 68, 0.20)", color: "rgba(252, 165, 165, 0.9)" }}>
            Deny
          </button>
        </div>
      )}
      <div className="flex items-end gap-2 px-3 py-2">
        <div className="relative flex-1">
          <textarea
            ref={inputRef}
            rows={1}
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={e => {
              if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); }
              if (e.key === "Escape") { if (loading) cancel(); else inputRef.current?.blur(); }
            }}
            placeholder={isPermission ? "Type y/n or use buttons above..." : isThinking ? "Thinking..." : "Send a command...   Ctrl+K"}
            className={`w-full px-3 py-1.5 rounded-lg text-[10px] font-mono text-txt-secondary placeholder:text-txt-tertiary outline-none transition-all focus:ring-1 resize-none overflow-hidden ${isPermission ? "focus:ring-amber-500/30 border-amber-500/20" : "focus:ring-indigo-500/30"} ${isThinking ? "border-cyan-500/20" : ""}`}
            style={{ background: "rgba(255, 255, 255, 0.04)", border: `1px solid ${isPermission ? "rgba(251, 191, 36, 0.15)" : isThinking ? "rgba(34, 211, 238, 0.15)" : "rgba(255, 255, 255, 0.06)"}` }}
          />
          {loading && !isPermission && (
            <div className="absolute right-2.5 bottom-2">
              <div className={`w-3 h-3 rounded-full border animate-spin ${isThinking ? "border-cyan-400/50 border-t-cyan-400" : "border-indigo-400/50 border-t-indigo-400"}`} />
            </div>
          )}
        </div>
        <button
          onClick={() => setShowRaw(!showRaw)}
          className={`px-2 py-1.5 rounded-lg text-[9px] font-mono transition-all ${showRaw ? "text-cyan-300/80" : "text-txt-tertiary/50 hover:text-txt-tertiary"}`}
          style={{ background: showRaw ? "rgba(34, 211, 238, 0.08)" : "transparent", border: `1px solid ${showRaw ? "rgba(34, 211, 238, 0.15)" : "rgba(255, 255, 255, 0.04)"}` }}
          title="Toggle raw output"
        >
          {"</>"}
        </button>
        {loading ? (
          <button
            onClick={cancel}
            className="px-3 py-1.5 rounded-lg transition-all"
            style={{ background: "rgba(239, 68, 68, 0.20)", border: "1px solid rgba(239, 68, 68, 0.15)", color: "rgba(252, 165, 165, 0.9)" }}
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
              <rect x="3" y="3" width="18" height="18" rx="2" />
            </svg>
          </button>
        ) : (
          <button
            onClick={send}
            disabled={!input.trim()}
            className="px-3 py-1.5 rounded-lg transition-all disabled:opacity-30"
            style={{ background: "rgba(99, 102, 241, 0.20)", border: "1px solid rgba(99, 102, 241, 0.15)", color: "rgba(165, 180, 252, 0.9)" }}
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
              <line x1="22" y1="2" x2="11" y2="13" /><polygon points="22 2 15 22 11 13 2 9 22 2" />
            </svg>
          </button>
        )}
      </div>
    </div>
  );
}

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

function MonitorView({ current, history }: { current: HwMetrics | null; history: HwMetrics[] }) {
  if (!current) return (
    <div className="flex items-center justify-center h-full">
      <p className="text-[11px] font-sans text-txt-tertiary">Waiting for hardware data...</p>
    </div>
  );

  const { cpu, memory, gpu, processes } = current;

  const cpuHistory = history.map(h => h.cpu.percent);
  const memHistory = history.map(h => h.memory.percent);
  const cpuSparkline = cpuHistory.slice(-60);
  const memSparkline = memHistory.slice(-60);
  const cpuPeak = cpuHistory.length > 0 ? Math.max(...cpuHistory) : 0;
  const memPeak = memHistory.length > 0 ? Math.max(...memHistory) : 0;

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
}

function StatusBar({ connected, onOpenSettings, activeView, onViewChange, updateStatus }: { connected: boolean; onOpenSettings: () => void; activeView: string; onViewChange: (v: string) => void; updateStatus: string }) {
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
            { id: "map", label: "MAP", enabled: true },
            { id: "flow", label: "FLOW", enabled: false },
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
}

function formatDuration(ms: number): string { const s = Math.floor(ms / 1000), m = Math.floor(s / 60), h = Math.floor(m / 60); if (h > 0) return `${h}h${String(m % 60).padStart(2, "0")}m`; if (m > 0) return `${m}m${String(s % 60).padStart(2, "0")}s`; return `${s}s`; }

const MAX_CARDS = 60;
const defaultMetrics: Metrics = { tokens: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, cost: 0, turns: 0, toolCalls: 0, elapsed: 0, velocity: 0, startTime: Date.now(), hourlyTurns: 0, topFiles: [], errorCount: 0, activeSubagents: [], plan: undefined, modelBreakdown: [], usage: undefined };

interface HwMetrics {
  cpu: { percent: number };
  memory: { usedGB: number; totalGB: number; percent: number };
  gpu: { available: boolean; name?: string; utilPercent?: number; vramUsedMB?: number; vramTotalMB?: number; tempC?: number } | null;
  processes: { pid: number; name: string; cpuPercent: number; memoryMB: number; parentPid: number }[];
}

export default function Dashboard() {
  const [connected, setConnected] = useState(false);
  const [session, setSession] = useState<SessionInfo | null>(null);
  const [cards, setCards] = useState<FeedCard[]>([]);
  const [metrics, setMetrics] = useState<Metrics>(defaultMetrics);
  const [model, setModel] = useState("");
  const [pinnedErrors, setPinnedErrors] = useState<PinnedError[]>([]);
  const [projects, setProjects] = useState<ProjectInfo[]>([]);
  const [activeProjectId, setActiveProjectId] = useState<string | null>(null);
  const [highlightedCardId, setHighlightedCardId] = useState<string | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [activeView, setActiveView] = useState("feed");
  const [updateStatus, setUpdateStatus] = useState("idle");
  const [fileTargets, setFileTargets] = useState<Record<string, "neutral" | "snipe" | "focus">>({});
  const [hardwareMetrics, setHardwareMetrics] = useState<HwMetrics | null>(null);
  const [hardwareHistory, setHardwareHistory] = useState<HwMetrics[]>([]);
  const [settings, updateSettings, resetSettings] = useSettings();
  const feedRef = useRef<HTMLDivElement>(null);
  const autoScroll = useRef(true);
  const socketRef = useRef<Socket | null>(null);
  const sidebarSetTabRef = useRef<((tab: "projects" | "knowledge") => void) | null>(null);

  const overBudget = settings.sessionBudget > 0 && metrics.cost > settings.sessionBudget;

  const cycleFileTarget = useCallback((file: string) => {
    setFileTargets(prev => {
      const current = prev[file] || "neutral";
      const next = current === "neutral" ? "focus" : current === "focus" ? "snipe" : "neutral";
      return { ...prev, [file]: next };
    });
  }, []);

  const snipedFiles = useMemo(() => Object.entries(fileTargets).filter(([, v]) => v === "snipe").map(([k]) => k), [fileTargets]);
  const focusedFiles = useMemo(() => Object.entries(fileTargets).filter(([, v]) => v === "focus").map(([k]) => k), [fileTargets]);

  const onScroll = useCallback(() => { if (!feedRef.current) return; autoScroll.current = feedRef.current.scrollHeight - feedRef.current.scrollTop - feedRef.current.clientHeight < 80; }, []);
  const scrollBottom = useCallback(() => { if (autoScroll.current && feedRef.current) feedRef.current.scrollTo({ top: feedRef.current.scrollHeight, behavior: "smooth" }); }, []);

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
    setMetrics(defaultMetrics);
    setPinnedErrors([]);
    setSession(null);
    socketRef.current?.emit("switch_project", projectId);
  }, []);

  const jumpToCard = useCallback((cardId: string) => {
    const el = document.getElementById(`card-${cardId}`);
    if (el && feedRef.current) {
      el.scrollIntoView({ behavior: "smooth", block: "center" });
      setHighlightedCardId(cardId);
      setTimeout(() => setHighlightedCardId(null), 2000);
    }
  }, []);

  const openKnowledgeBank = useCallback(() => {
    sidebarSetTabRef.current?.("knowledge");
  }, []);

  useEffect(() => { const iv = setInterval(() => setMetrics(p => ({ ...p, elapsed: Date.now() - p.startTime })), 1000); return () => clearInterval(iv); }, []);

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
      setTimeout(scrollBottom, 150);
    });

    s.on("event", (ev: SessionEvent) => {
      const newCards = eventToCards(ev); if (!newCards.length) return;
      if (ev.model) setModel(ev.model);
      setCards(p => { const combined = [...p, ...newCards]; return combined.length > MAX_CARDS ? combined.slice(-MAX_CARDS) : combined; });
      setTimeout(scrollBottom, 80);
    });

    s.on("subagent_event", (ev: SessionEvent) => {
      const newCards = eventToCards(ev); if (!newCards.length) return;
      setCards(p => { const combined = [...p, ...newCards]; return combined.length > MAX_CARDS ? combined.slice(-MAX_CARDS) : combined; });
      setTimeout(scrollBottom, 80);
    });

    s.on("pinned_errors", (errs: PinnedError[]) => setPinnedErrors(errs));
    s.on("error_pinned", (err: PinnedError) => setPinnedErrors(p => [...p.slice(-9), err]));
    s.on("usage_updated", () => {});

    const hwApi = (window as unknown as Record<string, Record<string, (...args: unknown[]) => void>>).electronAPI;
    hwApi?.onHardwareMetrics?.((data: unknown) => {
      const d = data as HwMetrics;
      setHardwareMetrics(d);
      setHardwareHistory(prev => {
        const next = [...prev, d];
        return next.length > 120 ? next.slice(-120) : next;
      });
    });

    return () => { s.disconnect(); hwApi?.removeHardwareMetrics?.(); };
  }, [scrollBottom]);

  return (
    <div className={`h-screen w-screen flex flex-col overflow-hidden rounded-2xl border ${overBudget ? "border-red-500/50 animate-pulse" : "border-white/[0.10]"}`}
         {...(settings.simpleHotspots ? { "data-simple-hotspots": true } : {})}
         style={{
           background: `rgba(13, 14, 18, ${settings.glassOpacity})`,
           backdropFilter: settings.blurIntensity === "none" ? "none" : `blur(${settings.blurIntensity === "high" ? 60 : 25}px) saturate(160%)`,
           WebkitBackdropFilter: settings.blurIntensity === "none" ? "none" : `blur(${settings.blurIntensity === "high" ? 60 : 25}px) saturate(160%)`,
           boxShadow: "var(--glass-glow), 0 25px 50px -12px rgba(0,0,0,0.5)",
         }}>
      <StatusBar connected={connected} onOpenSettings={() => setSettingsOpen(true)} activeView={activeView} onViewChange={setActiveView} updateStatus={updateStatus} />

      <div className="flex-1 flex min-h-0 h-full">
        <div className="w-[180px] shrink-0 h-full border-r border-white/[0.10] p-0 m-0 relative z-10"
             style={settings.sidebarShadows ? { boxShadow: "20px 0 35px rgba(0,0,0,0.5), 8px 0 15px rgba(0,0,0,0.3)" } : undefined}>
          <LeftSidebar projects={projects} activeProjectId={activeProjectId} onSelect={switchProject} cards={cards} onJumpToCard={jumpToCard} onSetTab={(setter) => { sidebarSetTabRef.current = setter; }} fileTargets={fileTargets} />
        </div>

        <div className="flex-1 w-0 min-w-0 h-full flex flex-col mx-[-1px] p-0 m-0 relative z-0">
          <AnimatePresence mode="wait">
            {activeView === "feed" && (
              <motion.div key="feed-view" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.25 }} className="flex-1 flex flex-col min-h-0">
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
                      <AnimatePresence initial={false} mode="popLayout">
                        {cards.map((card, i) => (
                          <motion.div key={card.id} id={`card-${card.id}`} layout variants={cardMotion} initial="initial" animate="animate" exit="exit"
                            transition={{ ...cardTr, delay: i >= cards.length - 4 ? (cards.length - 1 - i) * 0.04 : 0 }}
                            className={highlightedCardId === card.id ? "card-highlight-pulse rounded-xl" : ""}>
                            <CardRouter card={card} onLearnMore={openKnowledgeBank} />
                          </motion.div>
                        ))}
                      </AnimatePresence>
                    </div>
                  )}
                </div>
              </motion.div>
            )}
            {activeView === "map" && (
              <motion.div key="map-view" initial={{ opacity: 0, scale: 0.97 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.97 }} transition={{ duration: 0.3, ease: [0.16, 1, 0.3, 1] }} className="flex-1 min-h-0">
                <LogicMap cards={cards} fileTargets={fileTargets} onJumpToCard={(cardId) => { setActiveView("feed"); setTimeout(() => jumpToCard(cardId), 100); }} />
              </motion.div>
            )}
            {activeView === "monitor" && (
              <motion.div key="monitor-view" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.25 }} className="flex-1 min-h-0">
                <MonitorView current={hardwareMetrics} history={hardwareHistory} />
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        <div className="w-[180px] shrink-0 h-full border-l border-white/[0.10] p-0 m-0 relative z-10"
             style={settings.sidebarShadows ? { boxShadow: "-20px 0 35px rgba(0,0,0,0.5), -8px 0 15px rgba(0,0,0,0.3)" } : undefined}>
          <Sidebar metrics={metrics} model={model} session={session} onReset={() => socketRef.current?.emit("reset_stats")} fileTargets={fileTargets} onCycleTarget={cycleFileTarget} snipedCount={snipedFiles.length} hardwareMetrics={hardwareMetrics} />
        </div>
      </div>

      <CommandBar />

      <AnimatePresence>
        {settingsOpen && <SettingsModal settings={settings} onUpdate={updateSettings} onReset={resetSettings} onClose={() => setSettingsOpen(false)} />}
      </AnimatePresence>
    </div>
  );
}
