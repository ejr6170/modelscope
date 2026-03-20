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
- Label text right of the circle: agent type (from `subagentType` field, e.g., "code-reviewer", "Explore"). Falls back to `subagentDesc` truncated to 20 chars if type is null/undefined.
- Small metric text below the label: elapsed time (e.g., "45s") for active agents, or token count if available from the result.
- Connecting lines: thin (0.5-1px), straight, subtle color (rgba white ~10%)

**Spacing:**

- Vertical spacing between sibling nodes: 36px
- Horizontal spacing between tree levels: 180px
- Generous padding ensures readability even with 10+ agents

**Pan and zoom:** Reuse the existing drag/scroll handlers — same `offset`, `zoom`, `dragging` state and mouse event handlers. The SVG viewBox is computed from node positions.

**Empty state:** When no agents have been spawned (both `activeSubagents` and `completedAgents` are empty), the AGENTS view shows a centered placeholder: an icon, "No agents yet", and "Agents will appear here when Claude dispatches subagents." If `sessionInfo` is null, show "No active session" instead.

### 2. Side Detail Panel

Clicking any node opens a detail panel on the right side of the AGENTS view. The tree area shrinks to ~60% width, the panel takes ~40%.

**Panel content for an agent node:**

- Header: agent type, status badge (Active / Done / Failed), elapsed time since spawn
- Metrics row: token count (from result text length as proxy), tool calls count (counted from events)
- Activity feed: scrollable mini-feed of that agent's events. Events are keyed by the **unified agent ID** (see §3). Shows tool calls, file edits, text output as simple text entries — not full feed cards.
- Result summary: when agent is done, shows the final result text from `subagent_end` event (truncated with expand option)

**Panel content for the root session node:**

- Session metrics in wider format: tokens, cost, velocity, turns, elapsed
- Summary list of all agents spawned with their status

**Dismissing the panel:** Click the same node again, click an X button on the panel header, or press Escape. Tree re-centers to full width.

### 3. Data Model Changes

**Critical identity issue:** The server currently uses two different ID spaces for agents:

- `toolUseId` (from `tu.id` in `processEvent`) — used in `activeSubagents` Map, `subagent_start`, `subagent_end`
- `agentId` (filesystem-derived UUID from subagent log filenames) — used in `subagent_event` emissions from `checkSubagentLogs`

These two IDs have no join. To build a working detail panel, we must unify them.

**Fix: Create an ID mapping on the server.**

In `server.js`, maintain a `Map<string, string>` called `agentIdMap` that maps `toolUseId → filesystemAgentId`. When `subagent_start` fires for a `toolUseId`, also scan `findSubagentLogs` to find the corresponding log file and extract the filesystem `agentId`. Store the mapping. Then when `subagent_event` arrives with a filesystem `agentId`, look up the corresponding `toolUseId` and include it in the emission so the renderer can match events to the right tree node.

Alternatively (simpler): emit `subagent_event` with BOTH `agentId` (filesystem) AND `toolUseId` (from the mapping), and key everything on the renderer side by `toolUseId`. The renderer stores events as `Record<toolUseId, Event[]>`.

**Parent-child tracking fix:** The spec originally proposed detecting `event.isSubagentEvent` inside `processEvent`, but `processEvent` only handles root session events — subagent events flow through `checkSubagentLogs` instead and never call `processEvent`.

**Correct approach:** In `checkSubagentLogs`, when parsing a subagent's JSONL and encountering an `Agent` tool use (a sub-subagent spawn), emit a new event `subagent_nested_start` with the parent's `toolUseId` and the child's tool use details. The renderer uses this to build the tree hierarchy. For the MVP, if nested detection is too complex, a **flat tree** (all agents as children of root) is acceptable — hierarchy is a nice-to-have, not a blocker.

**`server.js` changes (~25 lines):**

- Add `agentIdMap` (Map<string, string>) at project state level
- In `processEvent` when `tu.isSubagent`: after adding to `activeSubagents`, also call `findSubagentLogs` to find the log file and store the `toolUseId → filesystemAgentId` mapping
- In `checkSubagentLogs`: when emitting `subagent_event`, look up the `toolUseId` from `agentIdMap` (reverse lookup) and include it in the emission
- In `subagent_end` handler: include the agent's accumulated events or at minimum the result text
- Remove: `parseDependencies` import, `/scan-dependencies` endpoint, `depCache`/`depCacheTime` variables
- Keep: `/scan-directory` endpoint (still used by other features, harmless dead code otherwise)

**`Dashboard.tsx` — New state:**

```tsx
const [completedAgents, setCompletedAgents] = useState<{ id: string; type: string; desc: string; startTime: string; result?: string; isError?: boolean; parentId?: string }[]>([]);
const [agentEvents, setAgentEvents] = useState<Record<string, { role: string; text?: string; toolUses?: unknown[]; timestamp?: string }[]>>({});
```

**New socket listeners (must be created from scratch — they don't exist today):**

- `s.on("subagent_end", ...)` — push to `completedAgents` with result, DO NOT discard
- `s.on("subagent_event", ...)` — append to `agentEvents[toolUseId]`, cap at 50 per agent
- Existing `s.on("subagent_start", ...)` already exists and populates `activeSubagents` via metrics

### 4. File Changes

**Removed:**

- `src/dependency-parser.js` — no longer needed
- `/scan-dependencies` endpoint in `server.js` — no longer needed
- `LogicMap` component, `flattenTree`, `layoutHierarchy`, `DirEntry`/`MapNode`/`MapEdge` interfaces, `extColor` function, `incomingCounts`/`activityScores`/`flowPath`/`depEdges` state in Dashboard.tsx

**Modified:**

**`server.js` (~25 lines changed):**

- Add `agentIdMap` for ID unification
- Populate mapping on `subagent_start`
- Include `toolUseId` in `subagent_event` emissions
- Remove `parseDependencies` import, `/scan-dependencies` endpoint + cache variables

**`app/components/Dashboard.tsx` (~300 lines net change):**

- Remove: `LogicMap` component and all MAP-related code (~300 lines removed)
- Add: `AgentsView` component with tree layout, node rendering, side panel (~300 lines added)
- Add: `completedAgents` and `agentEvents` state in Dashboard
- Add: socket listeners for `subagent_end` and `subagent_event`
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

- Nested agent hierarchy (sub-subagents) — MVP shows flat tree, hierarchy is future work
- Agent cost tracking (per-agent USD spend)
- Per-agent file tracking
- Agent performance comparison across sessions
- Re-dispatch / restart a failed agent from the UI
- Export agent tree as image
- Filter tree by status (show only active, only failed, etc.)
