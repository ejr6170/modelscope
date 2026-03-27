# Cursor Metrics & Pricing Fix — Design Spec

**Date:** 2026-03-27
**Status:** Approved
**Scope:** FLOW tab dual-provider, pricing fix

## Problem

1. **No Cursor visibility** — ModelScope only tracks Claude Code. Cursor (used for lighter tasks) has rich local data in `~/.cursor/ai-tracking/ai-code-tracking.db` (SQLite) that goes unused.
2. **Wrong pricing** — Opus 4.6 costs are 3x too high ($15/$75 vs correct $5/$25), Haiku 4.5 is also wrong. All cost calculations are inflated.

## Design

### 1. Fix Claude Pricing

Update `PRICING` constant in `src/parser.js:5-10`:

```javascript
const PRICING = {
  "claude-opus-4-6":           { input: 5 / 1e6, output: 25 / 1e6, cacheRead: 0.5 / 1e6, cacheWrite: 6.25 / 1e6 },
  "claude-opus-4-5-20251101":  { input: 15 / 1e6, output: 75 / 1e6, cacheRead: 1.5 / 1e6, cacheWrite: 18.75 / 1e6 },
  "claude-sonnet-4-6":         { input: 3 / 1e6,  output: 15 / 1e6, cacheRead: 0.3 / 1e6, cacheWrite: 3.75 / 1e6 },
  "claude-haiku-4-5-20251001": { input: 1 / 1e6, output: 5 / 1e6, cacheRead: 0.1 / 1e6, cacheWrite: 1.25 / 1e6 },
};
```

Note: Opus 4.5 (20251101) keeps old pricing — that was the correct price for that model version. Only 4.6 and Haiku 4.5 change.

Source: https://docs.anthropic.com/en/docs/about-claude/models — verified 2026-03-27.

### 2. FLOW Tab — Dual Provider Switcher

Add a toggle bar inside `FlowView` at the top: **[Claude Code] [Cursor]**

Styled like the existing Activity/Changes sub-tabs in AgentsView: small rounded buttons, active state with `bg-indigo-500/20 text-indigo-300`. Local `useState<"claude" | "cursor">` defaulting to `"claude"`.

When `"claude"` is selected, render existing FlowView content unchanged.
When `"cursor"` is selected, render `CursorFlowView`.

### 3. Cursor Metrics Server Module

**New file: `src/cursor-metrics.js`**

Reads `~/.cursor/ai-tracking/ai-code-tracking.db` using `better-sqlite3`.

**Dependency:** Add `better-sqlite3` to `package.json` `dependencies` explicitly (it's currently only in node_modules from a manual install, not declared). Native module — may need `electron-rebuild` for production builds.

Exports a single function:

```javascript
export function getCursorMetrics() → CursorMetrics
```

**CursorMetrics shape:**

```typescript
interface CursorMetrics {
  totalHashes: number;             // COUNT(*) from ai_code_hashes
  composerHashes: number;          // COUNT where source='composer'
  humanHashes: number;             // COUNT where source='human'
  aiPercentage: number;            // avg v2AiPercentage from scored_commits; fallback: composerHashes / totalHashes * 100 if no commits
  activeModel: string;             // most recent model from ai_code_hashes
  trackingSince: string;           // ISO date from tracking_state trackingStartTime

  // Timeline: hashes per day for last 30 days
  dailyActivity: { date: string; composer: number; human: number }[];

  // Top files by AI contribution count (top 15)
  topFiles: { fileName: string; fileExtension: string; count: number }[];

  // Recent scored commits (last 20)
  commits: {
    commitHash: string;
    commitMessage: string;
    commitDate: string;
    linesAdded: number;
    linesDeleted: number;
    composerLinesAdded: number;   // DB column: composerLinesAdded
    humanLinesAdded: number;      // DB column: humanLinesAdded
    aiPercentage: number;         // DB column: v2AiPercentage (parsed as float)
  }[];
}
```

**Implementation notes:**
- Open DB read-only with `{ readonly: true, fileMustExist: true }`
- Wrap in try/catch — if DB doesn't exist or is locked, return null
- All queries are simple aggregations, no writes
- Cache results for 30 seconds: module-level `let cache = { data: null, cachedAt: 0 }`. Return cached data if `Date.now() - cache.cachedAt < 30000`.
- `trackingSince` query: `SELECT value FROM tracking_state WHERE key = 'trackingStartTime'` → parse JSON `{"timestamp": N}` → convert to ISO date
- When `cursorMetrics` is null (DB not found), `CursorFlowView` shows a centered "Cursor not detected" empty state

### 4. Server Integration

In `server.js`:
- Import `getCursorMetrics` from `src/cursor-metrics.js`
- Add `cursor_metrics` to the `buildMetricsPayload()` return: `cursorMetrics: getCursorMetrics()`
- The 30s cache in cursor-metrics.js ensures this is cheap even though buildMetricsPayload runs frequently

### 5. Client — CursorMetrics Interface

Add to `Dashboard.tsx`:

```typescript
interface CursorMetrics {
  totalHashes: number;
  composerHashes: number;
  humanHashes: number;
  aiPercentage: number;
  activeModel: string;
  trackingSince: string;
  dailyActivity: { date: string; composer: number; human: number }[];
  topFiles: { fileName: string; fileExtension: string; count: number }[];
  commits: { commitHash: string; commitMessage: string; commitDate: string; linesAdded: number; linesDeleted: number; composerLinesAdded: number; humanLinesAdded: number; aiPercentage: number }[];
}
```

Add to `Metrics` interface: `cursorMetrics?: CursorMetrics | null;`

### 6. CursorFlowView Component

**Top Row — 4 Summary Cards:**

| Card | Content | Data |
|------|---------|------|
| AI Contributions | Total hash count with composer/human breakdown | `totalHashes`, `composerHashes`, `humanHashes` |
| AI vs Human | Percentage ring (reuse `ProgressRing`) | `aiPercentage` |
| Active Model | Model name, cleaned | `activeModel` |
| Tracking Since | Formatted date | `trackingSince` |

**Middle — Daily Activity Timeline:**
SVG bar chart (same visual style as Claude cost timeline):
- Bars grouped per day from `dailyActivity`
- Stacked bars: composer (cyan), human (amber). Currently only these two sources exist in the DB.
- X-axis: dates, Y-axis: hash count
- Auto-scroll right to most recent
- Chart dimensions match Claude timeline (120px height, 8px bars)

**Bottom Row — Two Panels:**

**Left: Top Files**
- Ranked list of top 15 files by AI contribution count
- Each row: file icon, fileName, count badge, horizontal bar showing relative proportion
- File extension color coding: `.tsx` = cyan, `.js` = amber, `.ts` = indigo, other = gray

**Right: Commit Scores**
- Scrollable list of recent commits from `commits`
- Each entry: short commit message (truncated 60 chars), lines +/- badge, AI % badge colored by threshold (same `ringColor` logic)
- Compact layout, max-height with overflow scroll

### 7. Previously Fixed Bugs (no action needed)

Both `/usage` sync and rate limit forwarding were already fixed in a prior Cursor session. Verified:
- `usage_updated` handler at line 2539 already merges data into state
- Rate limit forwarding via `CommandBar` `onRateLimit` prop at line 2635 already emits to server

## Files to Modify

| File | Change |
|------|--------|
| `package.json` | Add `better-sqlite3` to dependencies |
| `src/parser.js:5-10` | Fix Opus 4.6 and Haiku 4.5 pricing |
| `src/cursor-metrics.js` (new) | Cursor SQLite reader with 30s cache |
| `server.js` | Import cursor-metrics, add to buildMetricsPayload |
| `app/components/Dashboard.tsx` | CursorMetrics interface, provider toggle in FlowView, CursorFlowView component |

## Out of Scope

- Cursor billing/subscription API integration (server-side only, no local access)
- Writing to Cursor's SQLite DB
- Real-time Cursor event streaming (polling every 30s is sufficient)
- Cross-provider cost comparison charts (future)
