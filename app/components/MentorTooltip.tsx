"use client";
import React, { useState, useEffect, useRef, useCallback } from "react";
import { createPortal } from "react-dom";
import { motion, AnimatePresence } from "framer-motion";
import type { FeedCard, DetectedConcept } from "./types";

export const CONCEPT_DB: Record<string, { title: string; def: string }> = {
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
export const _conceptKeys = Object.keys(CONCEPT_DB).filter(k => k.length > 3);
export const _conceptRe = _conceptKeys.length > 0
  ? new RegExp(`\\b(${_conceptKeys.join("|")})\\b`, "gi")
  : null;

export function detectConceptsFromCards(cards: FeedCard[]): DetectedConcept[] {
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

export function MentorTooltipPortal({ targetEl, term, onLearnMore, onClose }: {
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

export function MentorTerm({ term, children, onLearnMore }: { term: string; children: React.ReactNode; onLearnMore?: () => void }) {
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
