# ModelScope Performance Optimization — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Eliminate tab switching lag, fix memory leaks, and extract Dashboard.tsx (~2800 lines) into focused modules for release readiness.

**Architecture:** Three-phase layered optimization: (1) critical perf fixes in-place, (2) memory leak and stability fixes, (3) file extraction into ~15 focused modules. Each phase produces a working, testable app.

**Tech Stack:** React 19, framer-motion, Socket.IO, TypeScript, Electron

---

## Phase 1: Critical Performance Fixes

### Task 1: Fix AnimatePresence Tab Switching Delay

**Files:**
- Modify: `app/components/Dashboard.tsx:2748` (AnimatePresence), `~2750,2780,2791,2796` (motion.div views)

- [ ] **Step 1: Change AnimatePresence mode**

At line 2748, change:
```tsx
<AnimatePresence mode="wait">
```
to:
```tsx
<AnimatePresence mode="popLayout">
```

- [ ] **Step 2: Add layout positioning to exit animations**

Each view's `motion.div` needs to animate out as an overlay so it doesn't compete for flex space with the incoming view. Update all four view motion.divs (feed, agents, flow, monitor) to add `exit` with absolute positioning:

```tsx
{activeView === "feed" && (
  <motion.div key="feed-view"
    initial={{ opacity: 0 }} animate={{ opacity: 1 }}
    exit={{ opacity: 0, position: "absolute", inset: 0 }}
    transition={{ duration: 0.15 }}
    className="flex-1 flex flex-col min-h-0">
```

Apply the same pattern to all four view motion.divs. Also reduce transition duration from `0.25` to `0.15` for snappier feel.

- [ ] **Step 3: Verify tab switching is instant**

Start the app with `npm run start`. Switch between all 4 tabs rapidly. Confirm no blocking delay — views should crossfade smoothly.

- [ ] **Step 4: Commit**

```bash
git add app/components/Dashboard.tsx
git commit -m "perf: fix tab switching lag — popLayout mode, faster transitions"
```

---

### Task 2: Pre-compute CONCEPT_DB Regex at Module Level

**Files:**
- Modify: `app/components/Dashboard.tsx:199-240` (highlightSyntax function), `~304-355` (CONCEPT_DB)

- [ ] **Step 1: Move CONCEPT_DB above highlightSyntax**

The `CONCEPT_DB` constant (lines 304-355) is currently defined AFTER `highlightSyntax` (lines 199-240) which references it. Move `CONCEPT_DB` to before `highlightSyntax` (e.g., after line 197).

- [ ] **Step 2: Extract regex compilation to module level**

After `CONCEPT_DB`, add these module-level constants (currently computed inside `highlightSyntax` on every call):

```typescript
const _conceptKeys = Object.keys(CONCEPT_DB).filter(k => k.length > 3);
const _conceptRe = _conceptKeys.length > 0
  ? new RegExp(`\\b(${_conceptKeys.join("|")})\\b`, "gi")
  : null;
```

- [ ] **Step 3: Update highlightSyntax to use pre-computed values**

Inside `highlightSyntax`, replace the lines that compute `conceptKeys` and `conceptRe` (~lines 215-216) with references to the module-level constants:

```typescript
const conceptRe = hotspots ? _conceptRe : null;
```

Remove the old `conceptKeys` and `conceptRe` variable declarations.

- [ ] **Step 4: Commit**

```bash
git add app/components/Dashboard.tsx
git commit -m "perf: pre-compute CONCEPT_DB regex at module level"
```

---

### Task 3: Wrap View Components with React.memo

**Files:**
- Modify: `app/components/Dashboard.tsx` — components at lines ~926, ~245, ~1097, ~1319, ~1455, ~1714, ~1741, ~2159, ~2387, ~2481

- [ ] **Step 1: Wrap components with React.memo**

For each of these components, change the function declaration to be wrapped in `React.memo`. Example pattern:

```typescript
// Before:
function CardRouter({ card }: { card: FeedCard }) {

// After:
const CardRouter = React.memo(function CardRouter({ card }: { card: FeedCard }) {
  // ... body unchanged ...
});
```

**Important:** `CostBadge` (~line 245) has an early return before its `useState`/`useEffect` hooks. Before wrapping in React.memo, move the hooks above the early return to comply with Rules of Hooks (hooks must not be after conditional returns). This was flagged in an earlier feedback memory.

Apply to these components (in file order):
1. `CostBadge` (~line 245) — fix hooks ordering first, then wrap
2. `CardRouter` (~line 926)
3. `AgentsView` (~line 1097)
4. `CursorFlowView` (~line 1319)
5. `ClaudeFlowContent` (~line 1455)
6. `FlowView` (~line 1714)
7. `Sidebar` (~line 1741)
8. `CommandBar` (~line 2159)
9. `MonitorView` (~line 2387)
10. `StatusBar` (~line 2481)

- [ ] **Step 2: Verify build passes**

```bash
npx next build 2>&1 | tail -5
```

Expected: Build succeeds with no TypeScript errors.

- [ ] **Step 3: Commit**

```bash
git add app/components/Dashboard.tsx
git commit -m "perf: wrap 10 components with React.memo to prevent unnecessary re-renders"
```

---

### Task 4: Extract useCallback for Inline Handlers

**Files:**
- Modify: `app/components/Dashboard.tsx:2574-2816` (Dashboard component)

- [ ] **Step 1: Add useCallback wrappers**

In the Dashboard component, after the existing `jumpToCard` useCallback (~line 2641) and before the useEffect blocks, add:

```typescript
const openSettings = useCallback(() => setSettingsOpen(true), []);
const closeSettings = useCallback(() => setSettingsOpen(false), []);
const resetStats = useCallback(() => socketRef.current?.emit("reset_stats"), []);
const handleRateLimit = useCallback((data: { status: string; resetsAt: string }) => {
  socketRef.current?.emit("rate_limit", data);
}, []);
```

- [ ] **Step 2: Replace inline arrows in JSX**

In the Dashboard return JSX:

Replace `onOpenSettings={() => setSettingsOpen(true)}` with `onOpenSettings={openSettings}`

Replace `onReset={() => socketRef.current?.emit("reset_stats")}` with `onReset={resetStats}`

Replace `onRateLimit={(data) => socketRef.current?.emit("rate_limit", data)}` with `onRateLimit={handleRateLimit}`

Replace `onClose={() => setSettingsOpen(false)}` in SettingsModal with `onClose={closeSettings}`

- [ ] **Step 3: Commit**

```bash
git add app/components/Dashboard.tsx
git commit -m "perf: extract inline handlers to useCallback for stable references"
```

---

### Task 5: Create useHardwareMetrics Custom Hook

**Files:**
- Modify: `app/components/Dashboard.tsx`

- [ ] **Step 1: Create the hook**

Add a new custom hook before the Dashboard component (e.g., after `createDefaultMetrics` at ~line 2554):

```typescript
function useHardwareMetrics() {
  const [hardwareMetrics, setHardwareMetrics] = useState<HwMetrics | null>(null);
  const [hardwareHistory, setHardwareHistory] = useState<HwMetrics[]>([]);

  useEffect(() => {
    const hwApi = (window as unknown as Record<string, Record<string, (...args: unknown[]) => void>>).electronAPI;
    hwApi?.onHardwareMetrics?.((data: unknown) => {
      const d = data as HwMetrics;
      setHardwareMetrics(d);
      setHardwareHistory(prev => {
        const next = [...prev, d];
        return next.length > 120 ? next.slice(-120) : next;
      });
    });
    return () => { hwApi?.removeHardwareMetrics?.(); };
  }, []);

  return { hardwareMetrics, hardwareHistory };
}
```

- [ ] **Step 2: Use the hook in Dashboard, remove old state**

In the Dashboard component:

Remove the `hardwareMetrics` and `hardwareHistory` useState declarations (~lines 2588-2589).

Add at the top of Dashboard (after the other useState calls):
```typescript
const { hardwareMetrics, hardwareHistory } = useHardwareMetrics();
```

Remove the hardware metrics listener block from the socket useEffect (~lines 2717-2725) and its cleanup (`hwApi?.removeHardwareMetrics?.()` at line 2727).

Update the socket useEffect cleanup to just:
```typescript
return () => { s.disconnect(); };
```

**Note (spec 2e):** The two separate `setState` calls in the hook (`setHardwareMetrics` + `setHardwareHistory`) are automatically batched by React 18+. No additional batching work needed — verify by confirming MonitorView doesn't flash/flicker on updates.

- [ ] **Step 3: Verify MonitorView still receives hardware data**

Start app, go to MONITOR tab. Confirm CPU/memory/GPU metrics update every 5 seconds.

- [ ] **Step 4: Commit**

```bash
git add app/components/Dashboard.tsx
git commit -m "perf: extract useHardwareMetrics hook to isolate hardware re-renders"
```

---

### Task 6: Create useAgentState Custom Hook

**Files:**
- Modify: `app/components/Dashboard.tsx`

- [ ] **Step 1: Create the hook**

Add after `useHardwareMetrics`:

```typescript
function useAgentState(socketRef: React.RefObject<Socket | null>) {
  const [completedAgents, setCompletedAgents] = useState<AgentNode[]>([]);
  const [agentEvents, setAgentEvents] = useState<Record<string, SessionEvent[]>>({});

  useEffect(() => {
    const s = socketRef.current;
    if (!s) return;

    const onSubagentEvent = (ev: SessionEvent & { toolUseId?: string; agentId?: string }) => {
      const agentKey = ev.toolUseId || ev.agentId || "";
      if (agentKey) {
        setAgentEvents(prev => {
          const events = prev[agentKey] || [];
          const updated = [...events, ev as SessionEvent];
          return { ...prev, [agentKey]: updated.length > 50 ? updated.slice(-50) : updated };
        });
      }
    };

    const onSubagentEnd = (data: { id: string; type?: string; desc?: string; startTime?: string; result?: string; isError?: boolean }) => {
      setCompletedAgents(prev => {
        const next = [...prev, {
          id: data.id, type: data.type || "", desc: data.desc || "",
          startTime: data.startTime || new Date().toISOString(),
          status: (data.isError ? "failed" : "done") as "active" | "done" | "failed",
          result: data.result, isError: data.isError,
        }];
        return next.length > 50 ? next.slice(-50) : next;
      });
      setAgentEvents(prev => { const copy = { ...prev }; delete copy[data.id]; return copy; });
    };

    s.on("subagent_event", onSubagentEvent);
    s.on("subagent_end", onSubagentEnd);
    return () => { s.off("subagent_event", onSubagentEvent); s.off("subagent_end", onSubagentEnd); };
  }, [socketRef]);

  const resetAgentState = useCallback(() => {
    setCompletedAgents([]);
    setAgentEvents({});
  }, []);

  return { completedAgents, agentEvents, setAgentEvents, resetAgentState };
}
```

- [ ] **Step 2: Use the hook in Dashboard, remove old state**

Remove `completedAgents` and `agentEvents` useState declarations (~lines 2590-2591).

Add in Dashboard:
```typescript
const { completedAgents, agentEvents, setAgentEvents, resetAgentState } = useAgentState(socketRef);
```

**Important:** The main socket useEffect's `subagent_event` handler (~line 2685) does TWO things: (1) inserts cards into the feed via `setCards()` and `scrollBottom()`, and (2) tracks agent events via `setAgentEvents()`. Only remove the `setAgentEvents` block from the main handler — keep the `setCards` and `scrollBottom` calls. The hook now independently listens for `subagent_event` to manage its own `agentEvents` state.

For `subagent_end` (~line 2699): remove the `setCompletedAgents` call from the main handler. Keep any other logic that remains (if none, remove the handler entirely since the hook handles it).

In `switchProject`, replace `setCompletedAgents([]); setAgentEvents({});` with `resetAgentState();`

**Note:** This task also implements spec 2b (bound data structures) — `completedAgents` is capped at 50 and `agentEvents` keys are cleaned up on agent end.

- [ ] **Step 3: Verify AGENTS tab still works**

Start app, trigger some agent activity. Confirm AGENTS tab shows active and completed agents.

- [ ] **Step 4: Commit**

```bash
git add app/components/Dashboard.tsx
git commit -m "perf: extract useAgentState hook, cap completedAgents at 50, clean agentEvents on end"
```

---

### Task 7: Memoize Expensive Chart Computations

**Files:**
- Modify: `app/components/Dashboard.tsx` — ClaudeFlowContent (~line 1455), MonitorView (~line 2387)

- [ ] **Step 1: Memoize ClaudeFlowContent calculations**

In `ClaudeFlowContent`, wrap the expensive calculations with `useMemo`:

```typescript
const ClaudeFlowContent = React.memo(function ClaudeFlowContent({ metrics }: { metrics: Metrics }) {
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
  }, [metrics.tokens, metrics.cost, elapsed, metrics.costHistory, metrics.tokens.cacheRead]);
```

- [ ] **Step 2: Memoize MonitorView sparkline computations**

In `MonitorView`, wrap the history-derived values:

```typescript
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
```

- [ ] **Step 3: Commit**

```bash
git add app/components/Dashboard.tsx
git commit -m "perf: memoize chart calculations in FlowView and MonitorView"
```

---

## Phase 2: Memory Leaks & Stability

### Task 8: Fix Leaked Timeouts

**Files:**
- Modify: `app/components/Dashboard.tsx` — Dashboard (~line 2634), CodeCard (~line 650), CodeLines (~line 733), DiffLines (~line 780)

- [ ] **Step 1: Fix highlightedCardId timeout in Dashboard**

In the Dashboard component, add a ref:
```typescript
const highlightTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
```

In `jumpToCard` (~line 2634), change:
```typescript
setTimeout(() => setHighlightedCardId(null), 2000);
```
to:
```typescript
if (highlightTimerRef.current) clearTimeout(highlightTimerRef.current);
highlightTimerRef.current = setTimeout(() => setHighlightedCardId(null), 2000);
```

Add cleanup useEffect:
```typescript
useEffect(() => () => {
  if (highlightTimerRef.current) clearTimeout(highlightTimerRef.current);
}, []);
```

- [ ] **Step 2: Fix CodeCard copy timeout**

In `CodeCard` (~line 650), the `copied` state uses setTimeout. Add a ref and cleanup:

```typescript
function CodeCard(...) {
  const [copied, setCopied] = useState(false);
  const copyTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => () => { if (copyTimerRef.current) clearTimeout(copyTimerRef.current); }, []);
```

Replace `setTimeout(() => setCopied(false), 1500)` with:
```typescript
if (copyTimerRef.current) clearTimeout(copyTimerRef.current);
copyTimerRef.current = setTimeout(() => setCopied(false), 1500);
```

- [ ] **Step 3: Fix CodeLines and DiffLines tooltip timers**

Both `CodeLines` (~line 733) and `DiffLines` (~line 780) have `enterTimerRef` and `leaveTimerRef` for tooltip hover. Add cleanup useEffects to both:

```typescript
useEffect(() => () => {
  if (enterTimerRef.current) clearTimeout(enterTimerRef.current);
  if (leaveTimerRef.current) clearTimeout(leaveTimerRef.current);
}, []);
```

- [ ] **Step 4: Commit**

```bash
git add app/components/Dashboard.tsx
git commit -m "fix: clean up leaked timeouts on unmount (highlight, copy, tooltips)"
```

---

### Task 9: Fix Socket.IO Effect Dependencies & ScrollBottom Ref

**Files:**
- Modify: `app/components/Dashboard.tsx:2574-2728` (Dashboard component)

- [ ] **Step 1: Add scrollBottom ref**

In Dashboard, after `socketRef`:
```typescript
const scrollBottomRef = useRef(scrollBottom);
```

Add a sync effect right after:
```typescript
useEffect(() => { scrollBottomRef.current = scrollBottom; });
```

- [ ] **Step 2: Update socket useEffect**

Change the socket useEffect dependency from `[scrollBottom]` to `[]`.

Inside the socket useEffect, replace all calls to `scrollBottom()` with `scrollBottomRef.current()` (there are 3 occurrences: after history, after event, and after subagent_event — note: subagent_event may have moved to the hook, in which case only 2).

- [ ] **Step 3: Fix chart auto-scroll snap**

In `ClaudeFlowContent` and `CursorFlowView`, find the `ref={el => { if (el) el.scrollLeft = el.scrollWidth; }}` pattern on chart containers.

Replace with a proper ref + effect pattern. For `ClaudeFlowContent`, add:

```typescript
const chartScrollRef = useRef<HTMLDivElement>(null);
const [isChartSticky, setIsChartSticky] = useState(true);

useEffect(() => {
  if (isChartSticky && chartScrollRef.current) {
    chartScrollRef.current.scrollLeft = chartScrollRef.current.scrollWidth;
  }
}, [metrics.costHistory, isChartSticky]);
```

Replace the chart container:
```tsx
<div className="overflow-x-auto" ref={chartScrollRef}
  onScroll={(e) => {
    const el = e.currentTarget;
    setIsChartSticky(el.scrollWidth - el.scrollLeft - el.clientWidth < 20);
  }}>
```

Apply same pattern in `CursorFlowView` for the daily activity chart.

- [ ] **Step 4: Commit**

```bash
git add app/components/Dashboard.tsx
git commit -m "fix: stabilize socket effect deps, fix chart auto-scroll snap"
```

---

## Phase 3: File Extraction

### Task 10: Extract Shared Types and Utilities

**Files:**
- Create: `app/components/types.ts`
- Create: `app/components/shared.tsx`
- Modify: `app/components/Dashboard.tsx`

- [ ] **Step 1: Create types.ts**

Extract all interfaces and type declarations from Dashboard.tsx (lines 8-95, 357-358, 1968-1981, 2556-2572) into `app/components/types.ts`:

```typescript
export interface ToolInput { ... }
export interface LineHunk { ... }
export interface LineInfo { ... }
export interface ToolUse { ... }
export interface SessionEvent { ... }
export interface ModelBreakdown { ... }
export interface PlanInfo { ... }
export interface CursorMetrics { ... }
export interface Metrics { ... }
export interface SessionInfo { ... }
export interface PinnedError { ... }
export interface ProjectInfo { ... }
export type CardKind = ...;
export interface FeedCard { ... }
export interface DetectedConcept { ... }
export interface HudSettings { ... }
export interface AgentNode { ... }
export interface HwMetrics { ... }
```

Copy them exactly as-is, adding `export` to each.

- [ ] **Step 2: Create shared.tsx**

Extract shared utility components and functions into `app/components/shared.tsx`:

```typescript
import React from "react";

export function ringColor(pct: number): string { ... }
export function modelColor(model: string): string { ... }
export function formatDuration(ms: number): string { ... }
export function shortPath(p: string): string { ... }
export const ProgressRing = React.memo(function ProgressRing({ pct, size = 48, stroke = 4 }: { pct: number; size?: number; stroke?: number }) { ... });
export const ProgressBar = React.memo(function ProgressBar(...) { ... });
export function SideMetric(...) { ... }
export function CpuIcon() { ... }
export function ZapIcon() { ... }
export function DollarIcon() { ... }
export function ClockIcon() { ... }
export function LayersIcon() { ... }
export function WrenchIcon() { ... }
```

- [ ] **Step 3: Update Dashboard.tsx imports**

Replace the extracted types and functions in Dashboard.tsx with imports:

```typescript
import type { ToolInput, LineHunk, LineInfo, ToolUse, SessionEvent, ModelBreakdown, PlanInfo, CursorMetrics, Metrics, SessionInfo, PinnedError, ProjectInfo, CardKind, FeedCard, DetectedConcept, HudSettings, AgentNode, HwMetrics } from "./types";
import { ringColor, modelColor, formatDuration, shortPath, ProgressRing, ProgressBar, SideMetric, CpuIcon, ZapIcon, DollarIcon, ClockIcon, LayersIcon, WrenchIcon } from "./shared";
```

Delete the original declarations from Dashboard.tsx.

- [ ] **Step 4: Verify build**

```bash
npx next build 2>&1 | tail -5
```

- [ ] **Step 5: Commit**

```bash
git add app/components/types.ts app/components/shared.tsx app/components/Dashboard.tsx
git commit -m "refactor: extract shared types and utility components"
```

---

### Task 11: Extract Cards, MentorTooltip, and Settings

**Files:**
- Create: `app/components/cards/CodeLines.tsx`
- Create: `app/components/cards/CardRouter.tsx`
- Create: `app/components/MentorTooltip.tsx`
- Create: `app/components/SettingsModal.tsx`
- Modify: `app/components/Dashboard.tsx`

**Note:** `CodeLines` depends on `MentorTooltipPortal`, so both must be extracted together to avoid a circular import at any commit boundary. Copy the full function bodies from Dashboard.tsx — do not use abbreviated `{ ... }` stubs.

- [ ] **Step 1: Create MentorTooltip.tsx**

Extract into `app/components/MentorTooltip.tsx`:
- `detectConceptsFromCards()` function
- `MentorTooltipPortal` component (~line 372)
- `MentorTerm` component (~line 513)

Import types from `./types`. Export all three.

- [ ] **Step 2: Create SettingsModal.tsx**

Extract into `app/components/SettingsModal.tsx`:
- `DEFAULT_SETTINGS` constant
- `useSettings()` hook
- `SettingsModal` component
- `SettingHeader`, `SettingToggle`, `SettingSlider` sub-components

Import `HudSettings` from `./types`. Export `useSettings` and `SettingsModal`.

- [ ] **Step 3: Create cards/CodeLines.tsx**

Extract into `app/components/cards/CodeLines.tsx`:
- `CONCEPT_DB` constant and pre-computed regex (`_conceptKeys`, `_conceptRe`)
- `highlightSyntax()` function
- `CodeLines` component (~line 733)
- `DiffLines` component (~line 780)
- `DiffModal` component (~line 839)

Import `MentorTooltipPortal` from `../MentorTooltip` (already extracted in Step 1). Import types from `../types`, shared utilities from `../shared`. Export `CONCEPT_DB`, `highlightSyntax`, `CodeLines`, `DiffLines`, `DiffModal`.

- [ ] **Step 4: Create cards/CardRouter.tsx**

Extract into `app/components/cards/CardRouter.tsx`:
- `eventToCards()` function
- `formatToolSummary()`, `formatTranscriptTool()` functions
- `CostBadge` component
- `cardMotion`, `cardTr` constants
- `RationaleToggle` component
- `CardWrap`, `ThoughtCard`, `ReplyCard`, `ReadCard`, `SubagentCard`, `CodeCard`, `ToolCard`, `UserCard`, `ErrorCard` components
- `Timestamp`, `AgentBadge` inline components
- `CardRouter` component

Import `CodeLines`, `DiffLines`, `DiffModal` from `./CodeLines`. Import `MentorTooltipPortal`, `MentorTerm` from `../MentorTooltip` if any card uses them directly.

- [ ] **Step 5: Update Dashboard.tsx imports**

```typescript
import { MentorTooltipPortal, MentorTerm, detectConceptsFromCards } from "./MentorTooltip";
import { useSettings, SettingsModal } from "./SettingsModal";
import { eventToCards, CardRouter, cardMotion, cardTr } from "./cards/CardRouter";
```

Delete all moved code from Dashboard.tsx.

- [ ] **Step 6: Verify build**

```bash
npx next build 2>&1 | tail -5
```

- [ ] **Step 7: Commit**

```bash
git add app/components/cards/ app/components/MentorTooltip.tsx app/components/SettingsModal.tsx app/components/Dashboard.tsx
git commit -m "refactor: extract cards, MentorTooltip, SettingsModal"
```

---

### Task 12: Extract View Components

**Files:**
- Create: `app/components/views/FlowView.tsx`
- Create: `app/components/views/AgentsView.tsx`
- Create: `app/components/views/MonitorView.tsx`
- Modify: `app/components/Dashboard.tsx`

- [ ] **Step 1: Create views/FlowView.tsx**

Extract:
- `CursorFlowView` component
- `ClaudeFlowContent` component
- `FlowView` component (the toggle wrapper)

Import types, shared components (`ProgressRing`, `ringColor`, `modelColor`), and any needed utilities.

- [ ] **Step 2: Create views/AgentsView.tsx**

Extract:
- `AgentChangesView` component
- `AgentsView` component

Import types, card components (`CodeLines`, `DiffLines`) as needed.

- [ ] **Step 3: Create views/MonitorView.tsx**

Extract:
- `MiniSparkline` component
- `ProcessTree` component
- `HistoryChart` component
- `MonitorView` component

Import types and shared utilities.

- [ ] **Step 4: Update Dashboard.tsx**

```typescript
import { FlowView } from "./views/FlowView";
import { AgentsView } from "./views/AgentsView";
import { MonitorView } from "./views/MonitorView";
```

- [ ] **Step 5: Verify build**

```bash
npx next build 2>&1 | tail -5
```

- [ ] **Step 6: Commit**

```bash
git add app/components/views/ app/components/Dashboard.tsx
git commit -m "refactor: extract FlowView, AgentsView, MonitorView to views/ directory"
```

---

### Task 13: Extract StatusBar, Sidebar, CommandBar

**Files:**
- Create: `app/components/StatusBar.tsx`
- Create: `app/components/Sidebar.tsx`
- Create: `app/components/CommandBar.tsx`
- Modify: `app/components/Dashboard.tsx`

- [ ] **Step 1: Create StatusBar.tsx**

Extract `StatusBar` component. Import types.

- [ ] **Step 2: Create Sidebar.tsx**

Extract:
- `SessionPanel` component
- `Sidebar` component

Import types, shared utilities (`ProgressBar`, `SideMetric`, icon components, `formatDuration`, `ringColor`).

- [ ] **Step 3: Create CommandBar.tsx**

Extract `CommandBar` component. Import types.

- [ ] **Step 4: Update Dashboard.tsx**

```typescript
import { StatusBar } from "./StatusBar";
import { Sidebar, SessionPanel } from "./Sidebar";
import { CommandBar } from "./CommandBar";
```

- [ ] **Step 5: Verify build**

```bash
npx next build 2>&1 | tail -5
```

- [ ] **Step 6: Commit**

```bash
git add app/components/StatusBar.tsx app/components/Sidebar.tsx app/components/CommandBar.tsx app/components/Dashboard.tsx
git commit -m "refactor: extract StatusBar, Sidebar, CommandBar"
```

---

### Task 14: Extract Custom Hooks & Final Cleanup

**Files:**
- Create: `app/components/hooks/useHardwareMetrics.ts`
- Create: `app/components/hooks/useAgentState.ts`
- Modify: `app/components/Dashboard.tsx`

- [ ] **Step 1: Move hooks to separate files**

Move `useHardwareMetrics` into `app/components/hooks/useHardwareMetrics.ts`.
Move `useAgentState` into `app/components/hooks/useAgentState.ts`.

Import types as needed.

- [ ] **Step 2: Update Dashboard.tsx imports**

```typescript
import { useHardwareMetrics } from "./hooks/useHardwareMetrics";
import { useAgentState } from "./hooks/useAgentState";
```

- [ ] **Step 3: Verify Dashboard.tsx is now ~150-200 lines**

Check the line count. Dashboard should contain only:
- Imports
- `MAX_CARDS`, `createDefaultMetrics()`
- `PinnedErrors` component (small, feed-specific)
- `Dashboard` component (state, socket setup, layout JSX)

- [ ] **Step 4: Verify full build and app functionality**

```bash
npx next build 2>&1 | tail -5
```

Start app, test all 4 tabs, verify everything works.

- [ ] **Step 5: Commit**

```bash
git add app/components/hooks/ app/components/Dashboard.tsx
git commit -m "refactor: extract custom hooks, Dashboard.tsx now ~150 lines"
```

---

### Task 15: Final End-to-End Verification

**Files:** None (testing only)

- [ ] **Step 1: Start the app**

```bash
npm run start
```

- [ ] **Step 2: Tab switching performance**

Rapidly switch between FEED → AGENTS → FLOW → MONITOR → FEED. Confirm instant transitions with no lag or flash.

- [ ] **Step 3: Memory stability**

Leave app running for 5+ minutes with an active Claude session. Switch tabs periodically. Confirm no growing lag or memory issues.

- [ ] **Step 4: Feature verification**

- FEED: Cards appear, scroll works, syntax highlighting renders
- AGENTS: Agent tree shows, changes view works
- FLOW: Claude Code metrics render, Cursor toggle works, charts scroll properly
- MONITOR: CPU/memory/GPU update every 5s, sparklines animate
- Settings modal opens/closes cleanly
- CommandBar input works

- [ ] **Step 5: Push to GitHub**

```bash
git push origin master
```
