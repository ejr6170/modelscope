# ModelScope Performance Optimization — Design Spec

**Date:** 2026-03-27
**Status:** Approved
**Scope:** Tab switching lag, memory leaks, file extraction for release readiness

## Problem

1. **Tab switching lag** — Switching between FEED/AGENTS/FLOW/MONITOR tabs has noticeable delay. Root cause: `AnimatePresence mode="wait"` blocks incoming view for 250ms while exit animation completes, compounded by waterfall re-renders from 15 state variables in a single component.
2. **Memory leaks** — Unbounded arrays (`completedAgents`, `agentEvents`), leaked timeouts (highlight, copy, tooltip timers), and socket listener thrashing on dependency changes.
3. **File size** — `Dashboard.tsx` is ~2800 lines with 20+ components, making it hard to maintain and reason about for release.

## Design

Three phases, each producing a working app. No phase depends on a later phase.

### Phase 1: Critical Performance Fixes

#### 1a. Fix AnimatePresence Blocking

**File:** `app/components/Dashboard.tsx` (~line 2748)

Change `<AnimatePresence mode="wait">` to `<AnimatePresence mode="popLayout">`. This allows the incoming view to render immediately while the outgoing view animates out, eliminating the 250ms sequential blocking delay.

**Implementation note:** With `popLayout`, the exiting and entering views briefly coexist in layout. Since each view uses `className="flex-1"`, two flex-1 children would split the space. Add `style={{ position: "absolute", inset: 0 }}` to the `exit` animation so the outgoing view overlays rather than sharing flex space.

#### 1b. Memoize View Components

Wrap these components with `React.memo()`:

| Component | Line | Why |
|-----------|------|-----|
| `StatusBar` | ~2481 | Re-renders on every metrics tick despite unchanged props |
| `Sidebar` | ~1741 | Receives full `metrics` object, re-renders on hardware updates |
| `FlowView` | ~1714 | Re-renders when cards/agents state changes |
| `AgentsView` | ~1097 | Re-renders on metrics ticks |
| `MonitorView` | ~2387 | Re-renders on card additions |
| `CardRouter` | ~926 | Rendered 60x per feed, re-renders on any parent state change |
| `CostBadge` | ~245 | Rendered inside CardRouter 60x, each spins up a rAF animation loop |
| `CommandBar` | ~2159 | Re-renders on metrics/cards changes |

#### 1c. Split Hot State Into Custom Hooks

**`useHardwareMetrics()` hook** — Owns `hardwareMetrics` and `hardwareHistory` state. Only `MonitorView` subscribes. Registers the `electronAPI.onHardwareMetrics` listener internally. Returns `{ hardwareMetrics, hardwareHistory }`.

**`useAgentState()` hook** — Owns `completedAgents` and `agentEvents` state. Only `AgentsView` subscribes. Socket listeners for `subagent_event` and `subagent_end` move into this hook. Returns `{ completedAgents, agentEvents }`.

This prevents hardware ticks (every 5s) and agent events from re-rendering the feed, sidebar, flow, etc.

#### 1d. Memoize Expensive Computations

- **Inline handlers → useCallback:** Extract the inline arrow functions at lines ~2739 (`() => setSettingsOpen(true)`), ~2805 (`() => socketRef.current?.emit("reset_stats")`), and ~2809 (`(data) => socketRef.current?.emit("rate_limit", data)`) into named `useCallback` variables above the return statement. These create new function references on every render, defeating React.memo on `StatusBar`, `Sidebar`, and `CommandBar`.
- **Chart calculations → useMemo:** `maxCost`, burn rate, sparkline slicing in FlowView/MonitorView. Currently recomputed on every render.
- **highlightSyntax regex → useMemo or module-level:** The `conceptKeys` filtering and `conceptRe` RegExp construction runs once per CodeLines/DiffLines render (up to 60x per feed update).

#### 1e. Pre-compute CONCEPT_DB Regex at Module Level

Move out of `highlightSyntax` function:

```javascript
const conceptKeys = Object.keys(CONCEPT_DB).filter(k => k.length > 3);
const conceptRe = conceptKeys.length > 0
  ? new RegExp(`\\b(${conceptKeys.join("|")})\\b`, "gi")
  : null;
```

These are static — no reason to recompute on every call.

### Phase 2: Memory Leaks & Stability

#### 2a. Clean Up Leaked Timeouts

| Timeout | Location | Fix |
|---------|----------|-----|
| `highlightedCardId` reset | `jumpToCard` (~line 2639) | Store in ref, clear on unmount via useEffect cleanup |
| Copy button reset | CodeCard (~line 676, 846) | Store in ref, clear on unmount |
| Mentor tooltip enter/leave | CodeLines (~line 747, 756, 796, 805) | Clear all timers on unmount, not just on mouseLeave |

Pattern: each component that uses `setTimeout` gets a `useEffect(() => () => clearTimeout(timerRef.current), [])` cleanup.

#### 2b. Bound Growing Data Structures

- **`completedAgents`** — Cap at 50 entries. When adding, slice to keep most recent 50.
- **`agentEvents`** — When `subagent_end` fires, delete the corresponding key from `agentEvents`. Currently keys accumulate forever.

#### 2c. Clean Up Socket.IO Effect Dependencies

**Problem:** The socket `useEffect` (line 2646) has `[scrollBottom]` as its dependency. While `scrollBottom` currently has a stable identity (`useCallback` with `[]` deps), this is fragile — any future change to its dependencies would cause all 10+ socket listeners to tear down and re-attach.

**Fix:** Use a ref for `scrollBottom` and change the effect dependency to `[]` (mount-only):
```javascript
const scrollBottomRef = useRef(scrollBottom);
scrollBottomRef.current = scrollBottom;
```

Inside handlers, call `scrollBottomRef.current()` instead of `scrollBottom()`. This is a hygiene fix that makes the socket lifecycle explicit and resilient to future changes.

#### 2d. Fix Auto-Scroll Snap on Charts

**Problem:** `ref={el => { if (el) el.scrollLeft = el.scrollWidth; }}` on chart containers fires on every render, snapping the user's scroll position back to the right.

**Fix:** Use a `useRef` + `useEffect` with a "sticky to right" flag:
- Track whether user has manually scrolled left (via `onScroll` handler)
- Only auto-scroll if the flag indicates "sticky to right"
- Reset sticky flag when new data arrives

This is the same pattern already described in `TODO.md` item #4.

#### 2e. Batch Hardware Metrics State Updates

**Problem:** Hardware data triggers two separate `setState` calls:
```javascript
setHardwareMetrics(d);
setHardwareHistory(prev => { ... });
```

**Fix:** Combine into a single state object or use `React.unstable_batchedUpdates` (or rely on React 18+ automatic batching, which should already batch these — verify this is actually causing double renders before changing).

### Phase 3: File Extraction

#### 3a. New File Structure

```
app/components/
  Dashboard.tsx              (~150 lines — thin shell, state, socket setup)
  types.ts                   (all shared interfaces)
  shared.tsx                 (ProgressRing, ringColor, modelColor, formatDuration)
  StatusBar.tsx              (~70 lines)
  Sidebar.tsx                (~200 lines — Sidebar + SessionPanel)
  CommandBar.tsx             (~170 lines)
  SettingsModal.tsx          (~200 lines — modal + useSettings hook)
  MentorTooltip.tsx          (~120 lines — portal + CONCEPT_DB + hover logic)
  cards/
    CardRouter.tsx           (~400 lines — router + all card types)
    CodeLines.tsx            (~150 lines — CodeLines, DiffLines, highlightSyntax)
  views/
    FeedView.tsx             (~80 lines)
    FlowView.tsx             (~400 lines — toggle, ClaudeFlowContent, CursorFlowView)
    AgentsView.tsx           (~220 lines — AgentsView + AgentChangesView)
    MonitorView.tsx          (~120 lines — MonitorView + HistoryChart)
  hooks/
    useHardwareMetrics.ts    (~30 lines)
    useAgentState.ts         (~40 lines)
```

#### 3b. Extraction Rules

- **Pure move** — no logic changes during extraction. Each file gets exactly the code it had, plus import/export statements.
- Phase 1 & 2 optimizations are applied first, so extracted components already have `React.memo`, `useMemo`, `useCallback`, and clean lifecycle patterns.
- Shared types extracted to `types.ts`, shared utilities to `shared.tsx`.
- Each extracted component file exports a single default (the component) plus any named exports (sub-components used only by that view).

#### 3c. Dashboard.tsx After Extraction

The main file becomes a thin orchestrator:
- Imports all view components and hooks
- Declares top-level state (session, cards, metrics, connected, activeView, etc.)
- Sets up socket.io connection and event handlers
- Renders the layout skeleton with view switching

~150 lines, easy to read and review.

## Files to Modify/Create

| File | Change |
|------|--------|
| `app/components/Dashboard.tsx` | Phase 1: memo, hooks, animation fix. Phase 2: leak fixes. Phase 3: extract to shell |
| `app/components/types.ts` (new) | Shared TypeScript interfaces |
| `app/components/shared.tsx` (new) | ProgressRing, utility functions |
| `app/components/StatusBar.tsx` (new) | Extracted StatusBar |
| `app/components/Sidebar.tsx` (new) | Extracted Sidebar + SessionPanel |
| `app/components/CommandBar.tsx` (new) | Extracted CommandBar |
| `app/components/SettingsModal.tsx` (new) | Extracted SettingsModal + useSettings |
| `app/components/MentorTooltip.tsx` (new) | Extracted tooltip system |
| `app/components/cards/CardRouter.tsx` (new) | Extracted card components |
| `app/components/cards/CodeLines.tsx` (new) | Extracted syntax highlighting |
| `app/components/views/FeedView.tsx` (new) | Extracted feed view |
| `app/components/views/FlowView.tsx` (new) | Extracted flow views |
| `app/components/views/AgentsView.tsx` (new) | Extracted agents view |
| `app/components/views/MonitorView.tsx` (new) | Extracted monitor view |
| `app/components/hooks/useHardwareMetrics.ts` (new) | Hardware state hook |
| `app/components/hooks/useAgentState.ts` (new) | Agent state hook |

## Out of Scope

- Replacing framer-motion with a lighter animation library
- Server-side performance optimization (30s cursor metrics cache is sufficient)
- Electron main process optimizations (hardware monitor interval, IPC batching)
- Virtualized scrolling for feed cards (MAX_CARDS=60 is small enough)
- Code splitting / lazy loading views (app is Electron, not web — bundle size irrelevant)
