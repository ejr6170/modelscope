# Usage Metrics Flow Tab — Design Spec

**Date:** 2026-03-27
**Status:** Approved
**Scope:** FLOW tab, server metrics, Dashboard.tsx

## Problem

Claude Code recently changed its usage model and each prompt now uses significantly more resources than before. ModelScope has usage data scattered across the sidebar (session %, weekly %, tokens, cost) but no dedicated view for understanding usage patterns, per-prompt costs, model breakdown, or rate limit status. The disabled "FLOW" tab in the StatusBar is the designated location.

## Design

### 1. Server Data Layer

#### Cost History

Add `costHistory` array to `createFreshMetrics()`:

```javascript
costHistory: []  // { timestamp, inputTokens, outputTokens, cacheRead, cacheWrite, cost, model }[]
```

In `processEvent()`, inside the `event.role === "assistant"` block, after updating token/cost totals, push to `costHistory` when the event has tokens:

```javascript
// Inside the role === "assistant" block, after token/cost accumulation:
if (event.tokens && event.costUSD) {
  projectState.metrics.costHistory.push({
    timestamp: event.timestamp || new Date().toISOString(),
    inputTokens: event.tokens.input,
    outputTokens: event.tokens.output,
    cacheRead: event.tokens.cacheRead,
    cacheWrite: event.tokens.cacheWrite,
    cost: event.costUSD,
    model: event.model || "",
  });
  if (projectState.metrics.costHistory.length > 200) projectState.metrics.costHistory.shift();
}
```

#### Rate Limit History

Add `rateLimitHistory` array to `createFreshMetrics()`:

```javascript
rateLimitHistory: []  // { timestamp, status, resetsAt }[]
```

**Data path:** Rate limit events flow through two paths:

1. **JSONL path (server.js):** Raw JSONL entries have `type: "rate_limit_event"` with `rate_limit_info: { status, resetsAt }`. Add a case in `extractEvent()` in `src/parser.js` to return `{ type: "rateLimit", status, resetsAt }`. Then in `processEvent()` in `server.js`, check for this type before the `role === "assistant"` block and push to `rateLimitHistory`.

2. **Stream-json path (electron/main.js):** Already parsed as `{ type: "rateLimit", status, resetsAt }` at line 153. Forward to server via Socket.IO: `socketRef.current?.emit("rate_limit", { status, resetsAt })`. Add a socket handler in `server.js` to push to the active project's `rateLimitHistory`.

```javascript
// In processEvent(), before the role === "assistant" block:
if (event.type === "rateLimit") {
  projectState.metrics.rateLimitHistory.push({
    timestamp: new Date().toISOString(),
    status: event.status,
    resetsAt: event.resetsAt,
  });
  if (projectState.metrics.rateLimitHistory.length > 50) projectState.metrics.rateLimitHistory.shift();
  return; // Not a normal event, don't process further
}
```

#### Metrics Payload

Add to `buildMetricsPayload()`:

```javascript
costHistory: projectState.metrics.costHistory,
rateLimitHistory: projectState.metrics.rateLimitHistory,
```

### 2. Client Types

Add to `Metrics` interface in Dashboard.tsx:

```typescript
costHistory?: { timestamp: string; inputTokens: number; outputTokens: number; cacheRead: number; cacheWrite: number; cost: number; model: string }[];
rateLimitHistory?: { timestamp: string; status: string; resetsAt: string }[];
```

### 3. FlowView Component

A single `FlowView` component receiving `metrics: Metrics` as prop. Three visual sections stacked vertically with scrollable overflow.

#### Top Row — Summary Cards

Four horizontal cards in a grid:

| Card | Content | Data Source |
|------|---------|-------------|
| **Total Cost** | `$X.XX` with cost-per-hour rate below (e.g., "$1.20/hr") calculated as `cost / (elapsed / 3600000)` | `metrics.cost`, `metrics.elapsed` |
| **Tokens Used** | `Xk in / Xk out` with cache hit % below. Formula: `Math.round(cacheRead / (input + cacheRead) * 100)` or 0 if denominator is 0 | `metrics.tokens` |
| **Session Limit** | Circular progress ring with % and reset timer | `metrics.usage.sessionPercent`, `metrics.usage.resetLabel` |
| **Weekly Limit** | Circular progress ring with % | `metrics.usage.weeklyPercent` |

Session/Weekly limit cards show "Run /usage to sync" when data is unavailable (`null`).

#### Middle — Cost Timeline (Bar Chart)

Pure SVG bar chart, no external chart library.

- Each bar = one entry from `metrics.costHistory`
- Bar height = cost relative to max cost in history
- Bar color by model: opus variants = indigo-400, sonnet variants = cyan-400, haiku variants = amber-400
- X-axis: relative timestamps (e.g., "2m ago", "5m ago")
- Y-axis: cost in cents
- Hover tooltip: timestamp, model name, input/output tokens, cache read/write, cost
- Auto-scrolls to show most recent entries (container `overflow-x: auto`, `scrollLeft = scrollWidth`)
- Fixed bar width of 8px with 2px gap. Chart height: 120px. Shows last ~50 visible bars; older bars accessible by scrolling left.
- Empty state: "No cost data yet" centered text

Model color mapping uses string matching on model name: contains "opus" → indigo, contains "haiku" → amber, default (sonnet) → cyan.

#### Bottom Row — Two Panels Side by Side

**Left Panel: Model Breakdown**

- SVG ring/donut chart showing token distribution by model
- Uses `metrics.modelBreakdown` array (already exists)
- Legend below with: color dot, model name, token count formatted (e.g., "12.5k"), percentage
- No per-model cost (pricing data not available server-side; total cost is shown in summary cards)
- Ring colors match the bar chart model colors
- Donut: 80px diameter, 12px stroke width. Single model = full ring. Inner area shows total token count.

**Right Panel: Rate Limit Status**

- Session % horizontal gauge bar with numeric label and reset timer
- Weekly % horizontal gauge bar with numeric label
- Burn rate indicator: tokens/min calculated from `costHistory` using a 10-minute rolling window. Formula: sum tokens from entries within last 10 minutes, divide by minutes elapsed (min 1 min). If fewer than 2 entries in window, show "—".
- Projected time-to-limit: `remainingPercent / burnRatePercent * windowMinutes`. Where `burnRatePercent` is estimated as `sessionPercentChange / windowMinutes` (requires at least 2 data points with session % changes). If session % is null or burn rate is 0, show "—". Display format: "~Xh Ym" or "~Xm".
- Rate limit event log: scrollable list of last 10 entries from `rateLimitHistory`, each showing timestamp and status
- Empty state for event log: "No throttle events"

### 4. Enable FLOW Tab

In `StatusBar`, change `{ id: "flow", label: "FLOW", enabled: false }` to `enabled: true`.

In the main render, add:

```tsx
{activeView === "flow" && (
  <motion.div key="flow-view" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.25 }} className="flex-1 min-h-0">
    <FlowView metrics={metrics} />
  </motion.div>
)}
```

### 5. Component Architecture

```
StatusBar
  +-- FLOW tab (enabled)

FlowView (new component in Dashboard.tsx)
  +-- SummaryCards (4x grid)
  |    +-- CostCard
  |    +-- TokensCard
  |    +-- SessionLimitCard (circular progress)
  |    +-- WeeklyLimitCard (circular progress)
  +-- CostTimeline (SVG bar chart)
  |    +-- Tooltip (hover state)
  +-- BottomPanels (2-column grid)
       +-- ModelBreakdown (SVG donut + legend)
       +-- RateLimitPanel (gauges + event log)
```

All components live inside Dashboard.tsx following the existing single-file pattern. No new files.

### 6. Styling

- Match existing glass/dark aesthetic (var(--glass-card), var(--glass-border), etc.)
- Font sizes consistent with existing: 7-10px labels, JetBrains Mono for numbers
- SVG charts use currentColor and opacity for theming
- Circular progress rings: SVG `<circle>` with `stroke-dasharray`/`stroke-dashoffset`. Color thresholds: 0-60% = emerald-400, 60-80% = amber-400, 80-100% = red-400. Ring size: 48px diameter, 4px stroke.
- No external dependencies (no chart libraries)

## Files to Modify

| File | Change |
|------|--------|
| `src/parser.js` | Add `rate_limit_event` case to `extractEvent()` returning `{ type: "rateLimit", status, resetsAt }` |
| `server.js` | Add `costHistory` + `rateLimitHistory` to metrics, include in `buildMetricsPayload()`, push data in `processEvent()`, add socket handler for stream-json rate limits |
| `app/components/Dashboard.tsx` | Add `FlowView` component with all sub-sections, update `Metrics` interface, enable FLOW tab, wire view routing |
| `electron/main.js` | Forward `rateLimit` stream events to server via IPC/socket |

## Out of Scope

- Historical usage across sessions (future — would need persistent storage)
- Cost alerts/notifications (future)
- Usage export/reporting (future)
- Billing integration (future)
