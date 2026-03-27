# Usage Metrics FLOW Tab Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a full usage metrics dashboard to the disabled FLOW tab — per-prompt cost timeline, rate limit tracking, model breakdown, and projected time-to-limit.

**Architecture:** Server adds `costHistory` and `rateLimitHistory` arrays to metrics, exposed in the payload. Parser gains rate limit event extraction. Dashboard.tsx gets a `FlowView` component with SVG charts, progress rings, and gauges — all pure SVG, no chart libraries. The existing disabled FLOW tab in StatusBar is enabled and wired to FlowView.

**Tech Stack:** Node.js server (server.js), React/TypeScript (Dashboard.tsx), SVG for charts, Socket.IO for real-time data.

**Spec:** `docs/superpowers/specs/2026-03-27-usage-metrics-flow-tab-design.md`

---

### Task 1: Server — Add costHistory and rateLimitHistory to Metrics

**Files:**
- Modify: `server.js:26-39` (createFreshMetrics)
- Modify: `server.js:280-373` (processEvent)
- Modify: `server.js:398-427` (buildMetricsPayload)

- [ ] **Step 1: Add new arrays to `createFreshMetrics()`**

In `server.js`, add two new fields to the return object at line 38 (after `totalCodeTokens: 0`):

```javascript
    totalCodeTokens: 0,
    costHistory: [],
    rateLimitHistory: [],
```

- [ ] **Step 2: Push to costHistory in processEvent()**

In `server.js` `processEvent()`, inside the `if (event.role === "assistant")` block (line 284), after the `recentResponses` push (line 298), add:

```javascript
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

- [ ] **Step 3: Handle rateLimit events in processEvent()**

In `server.js` `processEvent()`, before the `if (event.role === "assistant")` block (line 284), add:

```javascript
  if (event.type === "rateLimit") {
    projectState.metrics.rateLimitHistory.push({
      timestamp: new Date().toISOString(),
      status: event.status,
      resetsAt: event.resetsAt,
    });
    if (projectState.metrics.rateLimitHistory.length > 50) projectState.metrics.rateLimitHistory.shift();
    emitToProjectViewers(projectId, "metrics", buildMetricsPayload(projectId));
    return;
  }
```

- [ ] **Step 4: Add socket handler for stream-json rate limit events**

In `server.js`, inside the `io.on("connection", ...)` handler (near line 694, alongside existing `dismiss_error` and `reset_stats` handlers), add:

```javascript
    socket.on("rate_limit", (data) => {
      const projectId = socketActiveProject.get(socket.id);
      if (!projectId) return;
      const projectState = getOrCreateProjectState(projectId);
      projectState.metrics.rateLimitHistory.push({
        timestamp: new Date().toISOString(),
        status: data.status || "unknown",
        resetsAt: data.resetsAt || "",
      });
      if (projectState.metrics.rateLimitHistory.length > 50) projectState.metrics.rateLimitHistory.shift();
      emitToProjectViewers(projectId, "metrics", buildMetricsPayload(projectId));
    });
```

- [ ] **Step 5: Include both arrays in buildMetricsPayload()**

In `server.js` `buildMetricsPayload()`, add after `efficiencyRatio` (line 425):

```javascript
    costHistory: projectState.metrics.costHistory,
    rateLimitHistory: projectState.metrics.rateLimitHistory,
```

- [ ] **Step 6: Verify server starts**

Run: `node server.js`
Expected: Server starts without errors. Kill it after confirming.

- [ ] **Step 7: Commit**

```bash
git add server.js
git commit -m "feat: add costHistory and rateLimitHistory to server metrics"
```

---

### Task 2: Parser — Extract Rate Limit Events from JSONL

**Files:**
- Modify: `src/parser.js:77-170` (extractEvent)

- [ ] **Step 1: Add rate_limit_event case to extractEvent()**

In `src/parser.js` `extractEvent()`, after the `if (entry.type === "system")` block (line 91-92) and before the `if (entry.type === "user"...)` block (line 94), add:

```javascript
  if (entry.type === "rate_limit_event" && entry.rate_limit_info) {
    return {
      ...base,
      type: "rateLimit",
      status: entry.rate_limit_info.status || "unknown",
      resetsAt: entry.rate_limit_info.resetsAt || "",
    };
  }
```

- [ ] **Step 2: Verify parser loads**

Run: `node -e "import('./src/parser.js').then(m => console.log('OK', Object.keys(m)))"`
Expected: `OK [ 'extractEvent', 'summarizeToolInput' ]`

- [ ] **Step 3: Commit**

```bash
git add src/parser.js
git commit -m "feat: extract rate_limit_event in JSONL parser"
```

---

### Task 3: Client Types — Update Metrics Interface

**Files:**
- Modify: `app/components/Dashboard.tsx:38-48` (Metrics interface)

- [ ] **Step 1: Add costHistory and rateLimitHistory to Metrics interface**

In `app/components/Dashboard.tsx`, the `Metrics` interface is at lines 38-48. Add two new fields before the closing brace. Change line 47-48 from:

```typescript
  efficiencyRatio?: number;
}
```

to:

```typescript
  efficiencyRatio?: number;
  costHistory?: { timestamp: string; inputTokens: number; outputTokens: number; cacheRead: number; cacheWrite: number; cost: number; model: string }[];
  rateLimitHistory?: { timestamp: string; status: string; resetsAt: string }[];
}
```

- [ ] **Step 2: Verify TypeScript compiles**

Run: `npx next build` (or `npx tsc --noEmit` if available)
Expected: No type errors related to Metrics.

- [ ] **Step 3: Commit**

```bash
git add app/components/Dashboard.tsx
git commit -m "feat: add costHistory and rateLimitHistory to Metrics interface"
```

---

### Task 4: FlowView Component — Summary Cards

**Files:**
- Modify: `app/components/Dashboard.tsx` (add FlowView component, ~line 1275 area, before Sidebar)

This task builds the top row of the FlowView: four summary cards showing Total Cost, Tokens Used, Session Limit, and Weekly Limit.

- [ ] **Step 1: Add helper function for progress ring color**

Add this helper function near the other utility functions at the top of Dashboard.tsx (around line 130, near the existing helpers):

```typescript
function ringColor(pct: number): string {
  if (pct >= 80) return "rgb(248, 113, 113)";
  if (pct >= 60) return "rgb(251, 191, 36)";
  return "rgb(52, 211, 153)";
}

function modelColor(model: string): string {
  if (model.includes("opus")) return "rgb(129, 140, 248)";
  if (model.includes("haiku")) return "rgb(251, 191, 36)";
  return "rgb(34, 211, 238)";
}
```

- [ ] **Step 2: Add ProgressRing sub-component**

Add this small SVG component near the helpers:

```typescript
function ProgressRing({ pct, size = 48, stroke = 4 }: { pct: number; size?: number; stroke?: number }) {
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
```

- [ ] **Step 3: Build FlowView with summary cards**

Add the `FlowView` component. Place it before the `Sidebar` component (around line 1275). This step adds just the summary cards section:

```typescript
function FlowView({ metrics }: { metrics: Metrics }) {
  const usage = metrics.usage;
  const sessionPct = usage?.sessionPercent ?? null;
  const weeklyPct = usage?.weeklyPercent ?? null;
  const resetLabel = usage?.resetLabel || null;
  const elapsed = metrics.elapsed || 1;
  const costPerHour = elapsed > 0 ? (metrics.cost / (elapsed / 3600000)) : 0;
  const totalIn = metrics.tokens.input + metrics.tokens.cacheRead;
  const cacheHitPct = totalIn > 0 ? Math.round((metrics.tokens.cacheRead / totalIn) * 100) : 0;

  return (
    <div className="h-full overflow-y-auto p-4 space-y-4">
      {/* Summary Cards */}
      <div className="grid grid-cols-4 gap-3">
        {/* Total Cost */}
        <div className="rounded-xl border border-white/[0.06] p-3 flex flex-col" style={{ background: "var(--glass-card)" }}>
          <span className="text-[7px] font-sans font-bold tracking-[0.2em] uppercase text-txt-tertiary">Total Cost</span>
          <span className="text-[18px] font-mono font-bold text-emerald-400 mt-1">${metrics.cost.toFixed(2)}</span>
          <span className="text-[8px] font-mono text-txt-tertiary mt-0.5">${costPerHour.toFixed(2)}/hr</span>
        </div>

        {/* Tokens Used */}
        <div className="rounded-xl border border-white/[0.06] p-3 flex flex-col" style={{ background: "var(--glass-card)" }}>
          <span className="text-[7px] font-sans font-bold tracking-[0.2em] uppercase text-txt-tertiary">Tokens Used</span>
          <div className="flex items-baseline gap-1 mt-1">
            <span className="text-[14px] font-mono font-bold text-indigo-300">{metrics.tokens.input >= 1000 ? `${(metrics.tokens.input / 1000).toFixed(1)}k` : metrics.tokens.input}</span>
            <span className="text-[9px] font-mono text-txt-tertiary">in</span>
            <span className="text-[14px] font-mono font-bold text-cyan-300">{metrics.tokens.output >= 1000 ? `${(metrics.tokens.output / 1000).toFixed(1)}k` : metrics.tokens.output}</span>
            <span className="text-[9px] font-mono text-txt-tertiary">out</span>
          </div>
          <span className="text-[8px] font-mono text-txt-tertiary mt-0.5">{cacheHitPct}% cache hit</span>
        </div>

        {/* Session Limit */}
        <div className="rounded-xl border border-white/[0.06] p-3 flex flex-col items-center" style={{ background: "var(--glass-card)" }}>
          <span className="text-[7px] font-sans font-bold tracking-[0.2em] uppercase text-txt-tertiary mb-1">Session</span>
          {sessionPct !== null ? (
            <>
              <div className="relative">
                <ProgressRing pct={sessionPct} />
                <span className="absolute inset-0 flex items-center justify-center text-[11px] font-mono font-bold text-txt-primary">{sessionPct}%</span>
              </div>
              {resetLabel && <span className="text-[7px] font-mono text-txt-tertiary mt-1">{resetLabel}</span>}
            </>
          ) : (
            <span className="text-[8px] font-mono text-txt-tertiary italic mt-2">Run /usage to sync</span>
          )}
        </div>

        {/* Weekly Limit */}
        <div className="rounded-xl border border-white/[0.06] p-3 flex flex-col items-center" style={{ background: "var(--glass-card)" }}>
          <span className="text-[7px] font-sans font-bold tracking-[0.2em] uppercase text-txt-tertiary mb-1">Weekly</span>
          {weeklyPct !== null ? (
            <>
              <div className="relative">
                <ProgressRing pct={weeklyPct} />
                <span className="absolute inset-0 flex items-center justify-center text-[11px] font-mono font-bold text-txt-primary">{weeklyPct}%</span>
              </div>
            </>
          ) : (
            <span className="text-[8px] font-mono text-txt-tertiary italic mt-2">Run /usage to sync</span>
          )}
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Verify it renders**

Check for TypeScript/syntax errors by scanning the component. The full wiring happens in Task 7.

- [ ] **Step 5: Commit**

```bash
git add app/components/Dashboard.tsx
git commit -m "feat: add FlowView component with summary cards and progress rings"
```

---

### Task 5: FlowView — Cost Timeline Bar Chart

**Files:**
- Modify: `app/components/Dashboard.tsx` (extend FlowView component)

- [ ] **Step 1: Add CostTimeline section inside FlowView**

In the `FlowView` component from Task 4, the return JSX ends with `</div></div>`. Insert the following code **before the final closing `</div>`** (the one that closes the outer `<div className="h-full overflow-y-auto p-4 space-y-4">`), so it sits after the summary cards grid:

```typescript
      {/* Cost Timeline */}
      {(() => {
        const history = metrics.costHistory || [];
        if (history.length === 0) return (
          <div className="rounded-xl border border-white/[0.06] p-4 flex items-center justify-center" style={{ background: "var(--glass-card)", height: 160 }}>
            <span className="text-[9px] font-mono text-txt-tertiary">No cost data yet</span>
          </div>
        );
        const maxCost = Math.max(...history.map(h => h.cost), 0.0001);
        const barW = 8, gap = 2, chartH = 120;
        const svgW = history.length * (barW + gap);
        return (
          <div className="rounded-xl border border-white/[0.06] p-3" style={{ background: "var(--glass-card)" }}>
            <span className="text-[7px] font-sans font-bold tracking-[0.2em] uppercase text-txt-tertiary">Cost Per Turn</span>
            <div className="mt-2 overflow-x-auto" ref={(el) => { if (el) el.scrollLeft = el.scrollWidth; }}>
              <svg width={svgW} height={chartH} className="block">
                {history.map((h, i) => {
                  const barH = Math.max((h.cost / maxCost) * (chartH - 20), 2);
                  const x = i * (barW + gap);
                  const y = chartH - barH;
                  return (
                    <g key={i}>
                      <title>{`${h.model}\n$${h.cost.toFixed(4)}\n${h.inputTokens} in / ${h.outputTokens} out\nCache: ${h.cacheRead} read / ${h.cacheWrite} write\n${new Date(h.timestamp).toLocaleTimeString()}`}</title>
                      <rect x={x} y={y} width={barW} height={barH} rx={2} fill={modelColor(h.model)} opacity={0.8} className="hover:opacity-100 transition-opacity" />
                    </g>
                  );
                })}
              </svg>
            </div>
            {/* Legend */}
            <div className="flex items-center gap-3 mt-2">
              {[["opus", "rgb(129, 140, 248)"], ["sonnet", "rgb(34, 211, 238)"], ["haiku", "rgb(251, 191, 36)"]].map(([label, color]) => (
                <div key={label} className="flex items-center gap-1">
                  <div className="w-2 h-2 rounded-sm" style={{ background: color }} />
                  <span className="text-[7px] font-mono text-txt-tertiary">{label}</span>
                </div>
              ))}
            </div>
          </div>
        );
      })()}
```

- [ ] **Step 2: Commit**

```bash
git add app/components/Dashboard.tsx
git commit -m "feat: add cost timeline bar chart to FlowView"
```

---

### Task 6: FlowView — Model Breakdown and Rate Limit Panels

**Files:**
- Modify: `app/components/Dashboard.tsx` (extend FlowView component)

- [ ] **Step 1: Add bottom panels after the cost timeline**

Insert the following code after the cost timeline IIFE (from Task 5), still **before the final closing `</div>`** of FlowView's return JSX:

```typescript
      {/* Bottom Panels */}
      <div className="grid grid-cols-2 gap-3">
        {/* Model Breakdown */}
        <div className="rounded-xl border border-white/[0.06] p-3" style={{ background: "var(--glass-card)" }}>
          <span className="text-[7px] font-sans font-bold tracking-[0.2em] uppercase text-txt-tertiary">Model Breakdown</span>
          {(() => {
            const bd = metrics.modelBreakdown || [];
            if (bd.length === 0) return <span className="text-[8px] font-mono text-txt-tertiary block mt-2">No model data</span>;
            const total = bd.reduce((s, m) => s + m.tokens, 0);
            const size = 80, sw = 12, r = (size - sw) / 2, circ = 2 * Math.PI * r;
            let accumulated = 0;
            return (
              <div className="flex items-center gap-4 mt-2">
                <svg width={size} height={size} className="transform -rotate-90 shrink-0">
                  <circle cx={size/2} cy={size/2} r={r} fill="none" stroke="rgba(255,255,255,0.06)" strokeWidth={sw} />
                  {bd.map((m, i) => {
                    const pct = total > 0 ? m.tokens / total : 0;
                    const dashLen = pct * circ;
                    const dashOffset = -accumulated * circ;
                    accumulated += pct;
                    return <circle key={i} cx={size/2} cy={size/2} r={r} fill="none" stroke={modelColor(m.model)} strokeWidth={sw}
                      strokeDasharray={`${dashLen} ${circ - dashLen}`} strokeDashoffset={dashOffset} />;
                  })}
                  <text x={size/2} y={size/2} textAnchor="middle" dominantBaseline="central" className="fill-txt-primary text-[10px] font-mono font-bold" transform={`rotate(90 ${size/2} ${size/2})`}>
                    {total >= 1000 ? `${(total/1000).toFixed(0)}k` : total}
                  </text>
                </svg>
                <div className="space-y-1.5 flex-1 min-w-0">
                  {bd.map(m => (
                    <div key={m.model} className="flex items-center gap-2">
                      <div className="w-2 h-2 rounded-full shrink-0" style={{ background: modelColor(m.model) }} />
                      <span className="text-[8px] font-mono text-txt-secondary truncate flex-1">{m.model}</span>
                      <span className="text-[8px] font-mono text-txt-tertiary tabular-nums">{m.tokens >= 1000 ? `${(m.tokens/1000).toFixed(1)}k` : m.tokens}</span>
                      <span className="text-[8px] font-mono text-txt-tertiary tabular-nums">{m.pct}%</span>
                    </div>
                  ))}
                </div>
              </div>
            );
          })()}
        </div>

        {/* Rate Limit Status */}
        <div className="rounded-xl border border-white/[0.06] p-3" style={{ background: "var(--glass-card)" }}>
          <span className="text-[7px] font-sans font-bold tracking-[0.2em] uppercase text-txt-tertiary">Rate Limits</span>
          <div className="mt-2 space-y-2">
            {/* Session gauge */}
            <div>
              <div className="flex items-center justify-between mb-0.5">
                <span className="text-[8px] font-mono text-txt-secondary">Session</span>
                <span className="text-[8px] font-mono text-txt-tertiary tabular-nums">{sessionPct !== null ? `${sessionPct}%` : "\u2014"}</span>
              </div>
              <div className="h-1.5 rounded-full bg-white/[0.06] overflow-hidden">
                <div className="h-full rounded-full transition-all duration-500" style={{ width: `${sessionPct ?? 0}%`, background: sessionPct !== null ? ringColor(sessionPct) : "transparent" }} />
              </div>
              {resetLabel && <span className="text-[7px] font-mono text-txt-tertiary">{resetLabel}</span>}
            </div>

            {/* Weekly gauge */}
            <div>
              <div className="flex items-center justify-between mb-0.5">
                <span className="text-[8px] font-mono text-txt-secondary">Weekly</span>
                <span className="text-[8px] font-mono text-txt-tertiary tabular-nums">{weeklyPct !== null ? `${weeklyPct}%` : "\u2014"}</span>
              </div>
              <div className="h-1.5 rounded-full bg-white/[0.06] overflow-hidden">
                <div className="h-full rounded-full transition-all duration-500" style={{ width: `${weeklyPct ?? 0}%`, background: weeklyPct !== null ? ringColor(weeklyPct) : "transparent" }} />
              </div>
            </div>

            {/* Burn rate */}
            {(() => {
              const history = metrics.costHistory || [];
              const tenMinAgo = Date.now() - 10 * 60 * 1000;
              const recent = history.filter(h => new Date(h.timestamp).getTime() > tenMinAgo);
              if (recent.length < 2) return (
                <div className="flex items-center justify-between">
                  <span className="text-[8px] font-mono text-txt-secondary">Burn Rate</span>
                  <span className="text-[8px] font-mono text-txt-tertiary">{"\u2014"}</span>
                </div>
              );
              const windowMs = new Date(recent[recent.length-1].timestamp).getTime() - new Date(recent[0].timestamp).getTime();
              const windowMin = Math.max(windowMs / 60000, 1);
              const totalTok = recent.reduce((s, h) => s + h.inputTokens + h.outputTokens, 0);
              const tokPerMin = Math.round(totalTok / windowMin);
              return (
                <div className="flex items-center justify-between">
                  <span className="text-[8px] font-mono text-txt-secondary">Burn Rate</span>
                  <span className="text-[8px] font-mono text-amber-400 tabular-nums">{tokPerMin >= 1000 ? `${(tokPerMin/1000).toFixed(1)}k` : tokPerMin} tok/min</span>
                </div>
              );
            })()}

            {/* Projected time-to-limit */}
            {(() => {
              if (sessionPct === null || sessionPct >= 100) return null;
              const history = metrics.costHistory || [];
              const tenMinAgo = Date.now() - 10 * 60 * 1000;
              const recent = history.filter(h => new Date(h.timestamp).getTime() > tenMinAgo);
              if (recent.length < 2) return null;
              const windowMs = new Date(recent[recent.length-1].timestamp).getTime() - new Date(recent[0].timestamp).getTime();
              const windowMin = Math.max(windowMs / 60000, 1);
              const totalCostInWindow = recent.reduce((s, h) => s + h.cost, 0);
              const costPerMin = totalCostInWindow / windowMin;
              if (costPerMin <= 0) return null;
              const remainingPct = 100 - sessionPct;
              const estMinutes = Math.round(remainingPct * (metrics.cost / sessionPct) / costPerMin);
              const hrs = Math.floor(estMinutes / 60);
              const mins = estMinutes % 60;
              const label = hrs > 0 ? `~${hrs}h ${mins}m` : `~${mins}m`;
              return (
                <div className="flex items-center justify-between">
                  <span className="text-[8px] font-mono text-txt-secondary">Time to Limit</span>
                  <span className="text-[8px] font-mono text-red-400/80 tabular-nums">{label}</span>
                </div>
              );
            })()}

            {/* Rate limit event log */}
            {(() => {
              const events = (metrics.rateLimitHistory || []).slice(-10).reverse();
              if (events.length === 0) return (
                <div className="mt-1 pt-1 border-t border-white/[0.04]">
                  <span className="text-[7px] font-mono text-txt-tertiary italic">No throttle events</span>
                </div>
              );
              return (
                <div className="mt-1 pt-1 border-t border-white/[0.04] space-y-0.5 max-h-[80px] overflow-y-auto">
                  {events.map((ev, i) => (
                    <div key={i} className="flex items-center justify-between">
                      <span className="text-[7px] font-mono text-red-400/80">{ev.status}</span>
                      <span className="text-[7px] font-mono text-txt-tertiary">{new Date(ev.timestamp).toLocaleTimeString()}</span>
                    </div>
                  ))}
                </div>
              );
            })()}
          </div>
        </div>
      </div>
```

- [ ] **Step 2: Commit**

```bash
git add app/components/Dashboard.tsx
git commit -m "feat: add model breakdown donut and rate limit panel to FlowView"
```

---

### Task 7: Enable FLOW Tab and Wire View Routing

**Files:**
- Modify: `app/components/Dashboard.tsx:2045` (StatusBar FLOW button)
- Modify: `app/components/Dashboard.tsx:2319` (view routing)

- [ ] **Step 1: Enable FLOW tab in StatusBar**

In `app/components/Dashboard.tsx`, line 2045, change:

```typescript
            { id: "flow", label: "FLOW", enabled: false },
```

to:

```typescript
            { id: "flow", label: "FLOW", enabled: true },
```

- [ ] **Step 2: Add FlowView to the view router**

In `app/components/Dashboard.tsx`, after the `{activeView === "agents" && (` block (which ends around line 2317-2318), and before the `{activeView === "monitor" && (` block (line 2319), add:

```tsx
            {activeView === "flow" && (
              <motion.div key="flow-view" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.25 }} className="flex-1 min-h-0">
                <FlowView metrics={metrics} />
              </motion.div>
            )}
```

- [ ] **Step 3: Verify app builds**

Run: `npx next build`
Expected: Build succeeds with no type errors.

- [ ] **Step 4: Commit**

```bash
git add app/components/Dashboard.tsx
git commit -m "feat: enable FLOW tab and wire FlowView to view router"
```

---

### Task 8: Manual Smoke Test

- [ ] **Step 1: Start the dev environment**

Run in two terminals:
```bash
# Terminal 1:
node server.js

# Terminal 2:
npm run dev
```

Then start Electron:
```bash
npx electron electron/main.js --dev
```

- [ ] **Step 2: Verify FLOW tab appears and is clickable**

Click the FLOW tab in the top bar. Should show the FlowView with 4 summary cards. If no session is active, cost/tokens show $0.00 / 0, and session/weekly show "Run /usage to sync".

- [ ] **Step 3: Run a Claude session and verify data flows**

Start a Claude Code session in any project directory. Send a few prompts. Switch to FLOW tab and verify:
- Total Cost updates with each turn
- Cost timeline shows bars appearing
- Model breakdown shows the active model
- Token counts increase

- [ ] **Step 4: Final commit if any fixes needed**

```bash
git add server.js src/parser.js app/components/Dashboard.tsx
git commit -m "fix: flow tab smoke test fixes"
```
