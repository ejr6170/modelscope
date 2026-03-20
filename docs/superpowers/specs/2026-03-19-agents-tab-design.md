# AGENTS Tab — Design Spec

## Problem

ModelScope shows active agents in a small sidebar section and emits subagent events in the feed, but there's no dedicated view for watching agents work in real-time. When Claude dispatches multiple agents and subagents, there's no way to see the hierarchy, track individual agent progress, or drill into what a specific agent is doing.

## Solution

Replace the MAP tab with an AGENTS tab showing a left-to-right radial tree visualization. The root Claude session fans out to agents, which fan out to subagents. Each node shows live status, name, and a key metric. Clicking any node opens a side detail panel with the full activity feed for that agent.

## Design

### 1. Tree Visualization

**The MAP tab becomes AGENTS.** The StatusBar button changes from `{ id: "map", label: "MAP" }` to `{ id: "agents", label: "AGENTS" }`. The `LogicMap` component is replaced with an `AgentsView` component.

**Tree layout — left-to-right radial tree:**

- Root node on the far left: the current Claude Code session. Shows project name, total tokens, elapsed time.
- First-level branches fan out rightward: each agent spawned by the session. Thin connecting lines fan vertically from the root's right side to each agent.
- Second-level branches fan out further right: subagents spawned by agents. Lines connect parent to child.
- Layout supports arbitrary nesting depth.

**Node design:**

- Circle (12px radius in SVG) with status-colored fill:
  - Green with pulse animation = active/running
  - Indigo = completed successfully
  - Red = failed/errored
  - Gray = pending/starting
- Label text right of the circle: agent type or name (e.g., "code-reviewer", "Explore", "general-purpose")
- Small metric text below the label: token count (e.g., "2.1k tok") or elapsed time (e.g., "45s")
- Connecting lines: thin (0.5-1px), straight, subtle color (rgba white ~10%)

**Spacing:**

- Vertical spacing between sibling nodes: 36px
- Horizontal spacing between tree levels: 180px
- Generous padding ensures readability even with 10+ agents

**Pan and zoom:** Reuse the existing drag/scroll handlers from the former LogicMap — same `offset`, `zoom`, `dragging` state and mouse event handlers.

### 2. Side Detail Panel

Clicking any node opens a detail panel on the right side of the AGENTS view. The tree area shrinks to ~60% width, the panel takes ~40%.

**Panel content for an agent node:**

- Header: agent type, status badge (Active / Done / Failed), elapsed time since spawn
- Metrics row: token count (input + output), tool calls made, files touched count
- Activity feed: scrollable mini-feed of that agent's events, using the existing `subagent_event` data. Shows tool calls, file edits, text output — same card format as the main FEED but filtered to that agent's `agentId`.
- Result summary: when agent is done, shows the final result text from `subagent_end` event (truncated with expand option)

**Panel content for the root session node:**

- Session metrics in wider format: tokens, cost, velocity, turns, elapsed
- Summary list of all agents spawned with their status and token counts

**Dismissing the panel:** Click the same node again, click an X button on the panel header, or press Escape. Tree re-centers to full width.

### 3. Data Model Changes

**Current state:** The server tracks `activeSubagents` as a flat `Map<toolUseId, { type, desc, startTime, background }>`. When an agent finishes, it's deleted from the map via `subagent_end`. There's no parent-child relationship tracking, and completed agents disappear from state.

**Changes needed:**

**`server.js` — Add parent tracking (~10 lines):**

When processing an `Agent` tool use (`tu.isSubagent`), check if the event itself came from a subagent context (`event.isSubagentEvent === true` and `event.agentId` is set). If so, store the parent's `agentId` as `parentId` on the child subagent entry:

```
activeSubagents.set(tu.id, {
  type: tu.subagentType,
  desc: tu.subagentDesc,
  startTime: event.timestamp,
  background: tu.subagentBackground,
  parentId: event.isSubagentEvent ? event.agentId : null,
});
```

Include `parentId` in the `subagent_start` event emission and in the `metrics.activeSubagents` array so the renderer can build the tree.

**`Dashboard.tsx` — Add completed agents state:**

Currently, `subagent_end` events remove agents from `activeSubagents`. Add a `completedAgents` array in the Dashboard component that accumulates finished agents:

```
const [completedAgents, setCompletedAgents] = useState<CompletedAgent[]>([]);
```

On `subagent_end`, instead of losing the agent, push it to `completedAgents` with its final result and duration. The AGENTS view reads from both `metrics.activeSubagents` (live) and `completedAgents` (done) to build the full tree.

**`Dashboard.tsx` — Add per-agent event buffer:**

To power the detail panel's activity feed, store subagent events keyed by `agentId`:

```
const [agentEvents, setAgentEvents] = useState<Record<string, SubagentEvent[]>>({});
```

On each `subagent_event` socket event, append to the relevant agent's buffer (cap at 50 events per agent to prevent memory growth).

### 4. File Changes

**Removed:**

- `src/dependency-parser.js` — no longer needed
- `/scan-dependencies` endpoint in `server.js` — no longer needed
- `LogicMap` component, `flattenTree`, `layoutHierarchy`, `DirEntry`/`MapNode`/`MapEdge` interfaces, `extColor` function in Dashboard.tsx

**Modified:**

**`server.js` (~10 lines changed):**

- Add `parentId` field to subagent tracking in `processEvent`
- Include `parentId` in `subagent_start` emission and `buildMetricsPayload`
- Remove `parseDependencies` import and `/scan-dependencies` endpoint + cache variables

**`app/components/Dashboard.tsx` (~300 lines net change):**

- Remove: `LogicMap` component and all MAP-related code (~250 lines removed)
- Add: `AgentsView` component with tree layout, node rendering, side panel (~300 lines added)
- Add: `completedAgents` and `agentEvents` state in Dashboard
- Add: socket listener for `subagent_event` that populates `agentEvents`
- Update: `subagent_end` handler to move agent to `completedAgents` instead of discarding
- Update: StatusBar tab config: `map` → `agents`
- Update: view rendering: `activeView === "map"` → `activeView === "agents"`

**No changes to:** `electron/main.js`, `electron/preload.cjs`, `app/globals.css`, `src/hardware-monitor.js`, `src/parser.js`, `src/usage-cache.js`

### 5. What This Does NOT Change

- FEED view — unchanged
- MONITOR view — unchanged
- Sidebar metrics and hardware gauges — unchanged (sidebar still shows active agents in its compact section)
- Command bar — unchanged
- Socket.io session watching — unchanged (events still flow the same way)
- Auto-updater — unchanged

### 6. Future Extension (Out of Scope)

- Agent cost tracking (per-agent USD spend)
- Agent performance comparison across sessions
- Re-dispatch / restart a failed agent from the UI
- Export agent tree as image
- Filter tree by status (show only active, only failed, etc.)
