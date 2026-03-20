# AGENTS Tab Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the MAP tab with an AGENTS tab that shows a left-to-right tree of all agents/subagents with live status, metrics, and a click-to-expand detail panel.

**Architecture:** The server adds an ID mapping between toolUseId and filesystem agentId, then includes toolUseId in subagent_event emissions. The Dashboard removes all MAP/LogicMap code and adds an AgentsView component with tree layout, node rendering, and a side detail panel. New socket listeners track completed agents and per-agent events.

**Tech Stack:** React SVG for tree visualization, Socket.io for real-time agent events, existing server-side subagent tracking

---

## File Structure

| File | Action | Responsibility |
|------|--------|---------------|
| `server.js` | Modify | Add agentIdMap, include toolUseId in subagent_event, remove dependency endpoint |
| `app/components/Dashboard.tsx` | Modify | Remove LogicMap, add AgentsView, new state + socket listeners |
| `src/dependency-parser.js` | Delete | No longer needed |

---

### Task 1: Server-Side ID Mapping & Cleanup

**Files:**
- Modify: `server.js`

- [ ] **Step 1: Remove dependency parser import and endpoint**

At line 8, remove:
```javascript
import { parseDependencies } from "./src/dependency-parser.js";
```

At lines 16-17, remove:
```javascript
let depCache = null;
let depCacheTime = 0;
```

Remove the entire `/scan-dependencies` endpoint block (lines 122-131 approximately — find `if (req.method === "GET" && req.url === "/scan-dependencies")` and delete through its `return;`).

- [ ] **Step 2: Add agentIdMap to project state**

In the `createFreshMetrics` or `getOrCreateProjectState` area, the `projectState` object already has `activeSubagents` and `subagentWatchers` Maps. No new field needed on projectState — instead add a module-level Map after the existing module-level variables (around line 18):

```javascript
const agentIdMap = new Map();
```

- [ ] **Step 3: Populate the ID mapping when subagents are detected**

In the `checkSubagentLogs` function (line 487), after the `for (const sa of subagents)` loop starts, add logic to try mapping filesystem `agentId` to `toolUseId`. The mapping goes in both directions. After `const subagents = findSubagentLogs(projectState.currentFile);` (line 490), add:

```javascript
  for (const sa of subagents) {
    if (!agentIdMap.has(sa.agentId)) {
      for (const [tuId] of projectState.activeSubagents) {
        if (!Array.from(agentIdMap.values()).includes(tuId)) {
          agentIdMap.set(sa.agentId, tuId);
          break;
        }
      }
    }
  }
```

This is a best-effort mapping: it matches unmatched filesystem agent IDs to unmatched toolUseIds based on order.

- [ ] **Step 4: Include toolUseId in subagent_event emissions**

In `checkSubagentLogs` (line 515), change the existing emit:

```javascript
        emitToProjectViewers(projectId, "subagent_event", event);
```

To:

```javascript
        event.toolUseId = agentIdMap.get(sa.agentId) || sa.agentId;
        emitToProjectViewers(projectId, "subagent_event", event);
```

- [ ] **Step 5: Verify server starts**

Run: `node --check server.js`
Expected: no output

- [ ] **Step 6: Delete dependency parser**

```bash
rm src/dependency-parser.js
```

- [ ] **Step 7: Commit**

```bash
git add server.js
git rm src/dependency-parser.js
git commit -m "feat: add agent ID mapping, remove dependency parser"
```

---

### Task 2: Remove MAP Code from Dashboard

**Files:**
- Modify: `app/components/Dashboard.tsx`

- [ ] **Step 1: Remove LogicMap and all related code**

Delete the following blocks (lines approximate — search by content):

1. `interface DirEntry` (line 1019)
2. `interface MapNode` (line 1020)
3. `interface MapEdge` (line 1021)
4. `const extColor` function (lines 1023-1030)
5. `function flattenTree` (lines 1032-1045)
6. `const COL_WIDTH`, `const ROW_HEIGHT`, `const NODE_W`, `const NODE_H`, `const LANE_PAD` (lines 1043-1047)
7. `function layoutHierarchy` (lines 1049-1089)
8. The entire `function LogicMap` component (line 1091 through its closing `}` — approximately 300 lines)

Keep `const HOURLY_CAP = 60;` (line 1391) and everything after it.

- [ ] **Step 2: Update StatusBar tab config**

Find the tab array in StatusBar (around line 2220). Change:

```tsx
            { id: "map", label: "MAP", enabled: true },
```

To:

```tsx
            { id: "agents", label: "AGENTS", enabled: true },
```

- [ ] **Step 3: Update view rendering**

Find the MAP view rendering block (around line 2455). Change:

```tsx
            {activeView === "map" && (
              <motion.div key="map-view" ...>
                <LogicMap cards={cards} fileTargets={fileTargets} onJumpToCard={...} />
              </motion.div>
            )}
```

To a placeholder for now (we'll add AgentsView in Task 4):

```tsx
            {activeView === "agents" && (
              <motion.div key="agents-view" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.25 }} className="flex-1 min-h-0">
                <div className="flex items-center justify-center h-full">
                  <p className="text-[11px] font-sans text-txt-tertiary">Agents view loading...</p>
                </div>
              </motion.div>
            )}
```

- [ ] **Step 4: Verify build**

Run: `npx next build`
Expected: Build succeeds (LogicMap references are fully removed)

- [ ] **Step 5: Commit**

```bash
git add app/components/Dashboard.tsx
git commit -m "feat: remove MAP/LogicMap, add AGENTS tab placeholder"
```

---

### Task 3: Add Agent State & Socket Listeners

**Files:**
- Modify: `app/components/Dashboard.tsx`

- [ ] **Step 1: Add agent-related interfaces and state**

Before the `Dashboard` function, add:

```tsx
interface AgentNode {
  id: string;
  type: string;
  desc: string;
  startTime: string;
  background?: boolean;
  status: "active" | "done" | "failed";
  result?: string;
  isError?: boolean;
}

interface AgentEvent {
  role: string;
  text?: string;
  toolUses?: { tool: string; input?: Record<string, unknown> }[];
  timestamp?: string;
}
```

Inside the `Dashboard` function, after the existing state declarations, add:

```tsx
  const [completedAgents, setCompletedAgents] = useState<AgentNode[]>([]);
  const [agentEvents, setAgentEvents] = useState<Record<string, AgentEvent[]>>({});
```

- [ ] **Step 2: Add socket listeners for subagent_end and subagent_event**

In the socket `useEffect` (the one that creates the socket.io connection, around line 2350), add these listeners after the existing `s.on("subagent_event", ...)` handler:

```tsx
    s.on("subagent_end", (data: { id: string; type?: string; desc?: string; startTime?: string; result?: string; isError?: boolean }) => {
      setCompletedAgents(prev => [...prev, {
        id: data.id,
        type: data.type || "",
        desc: data.desc || "",
        startTime: data.startTime || new Date().toISOString(),
        status: data.isError ? "failed" : "done",
        result: data.result,
        isError: data.isError,
      }]);
    });
```

Update the existing `s.on("subagent_event", ...)` handler to ALSO populate `agentEvents`. Change:

```tsx
    s.on("subagent_event", (ev: SessionEvent) => {
      const newCards = eventToCards(ev); if (!newCards.length) return;
      setCards(p => { const combined = [...p, ...newCards]; return combined.length > MAX_CARDS ? combined.slice(-MAX_CARDS) : combined; });
      setTimeout(scrollBottom, 80);
    });
```

To:

```tsx
    s.on("subagent_event", (ev: SessionEvent & { toolUseId?: string; agentId?: string }) => {
      const newCards = eventToCards(ev); if (!newCards.length) return;
      setCards(p => { const combined = [...p, ...newCards]; return combined.length > MAX_CARDS ? combined.slice(-MAX_CARDS) : combined; });
      setTimeout(scrollBottom, 80);
      const agentKey = ev.toolUseId || ev.agentId || "";
      if (agentKey) {
        setAgentEvents(prev => {
          const events = prev[agentKey] || [];
          const newEvent: AgentEvent = { role: ev.role || "", text: ev.text, toolUses: ev.toolUses, timestamp: ev.timestamp };
          const updated = [...events, newEvent];
          return { ...prev, [agentKey]: updated.length > 50 ? updated.slice(-50) : updated };
        });
      }
    });
```

- [ ] **Step 3: Verify build**

Run: `npx next build`
Expected: Build succeeds

- [ ] **Step 4: Commit**

```bash
git add app/components/Dashboard.tsx
git commit -m "feat: add agent state tracking and socket listeners"
```

---

### Task 4: Create AgentsView Component

**Files:**
- Modify: `app/components/Dashboard.tsx`

- [ ] **Step 1: Add the AgentsView component**

Insert the following before the `StatusBar` function (where `LogicMap` used to be):

```tsx
function AgentsView({ activeAgents, completedAgents, agentEvents, session, metrics }: {
  activeAgents: { id: string; type?: string; desc?: string; startTime?: string; background?: boolean }[];
  completedAgents: AgentNode[];
  agentEvents: Record<string, AgentEvent[]>;
  session: SessionInfo | null;
  metrics: Metrics;
}) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const [zoom, setZoom] = useState(1);
  const [dragging, setDragging] = useState(false);
  const dragStart = useRef({ x: 0, y: 0, ox: 0, oy: 0 });

  const handleMouseDown = useCallback((e: React.MouseEvent) => { setDragging(true); dragStart.current = { x: e.clientX, y: e.clientY, ox: offset.x, oy: offset.y }; }, [offset]);
  const handleMouseMove = useCallback((e: React.MouseEvent) => { if (!dragging) return; setOffset({ x: dragStart.current.ox + (e.clientX - dragStart.current.x), y: dragStart.current.oy + (e.clientY - dragStart.current.y) }); }, [dragging]);
  const handleMouseUp = useCallback(() => setDragging(false), []);
  const handleWheel = useCallback((e: React.WheelEvent) => { setZoom(z => Math.max(0.3, Math.min(3, z + (e.deltaY > 0 ? -0.1 : 0.1)))); }, []);

  const allAgents = useMemo(() => {
    const agents: (AgentNode & { status: "active" | "done" | "failed" })[] = [];
    for (const a of activeAgents) {
      agents.push({ id: a.id, type: a.type || "", desc: a.desc || "", startTime: a.startTime || "", background: a.background, status: "active" });
    }
    for (const a of completedAgents) {
      if (!agents.some(x => x.id === a.id)) agents.push(a);
    }
    return agents;
  }, [activeAgents, completedAgents]);

  const selected = selectedId ? allAgents.find(a => a.id === selectedId) || (selectedId === "root" ? null : null) : null;
  const showPanel = selectedId !== null;

  const LEVEL_X = 180;
  const NODE_GAP = 36;
  const ROOT_X = 40;
  const rootY = Math.max(allAgents.length * NODE_GAP, 100) / 2;

  const statusColor = (s: string) => s === "active" ? "#4ade80" : s === "done" ? "#818cf8" : s === "failed" ? "#f87171" : "#64748b";

  const elapsed = (startTime: string) => {
    if (!startTime) return "";
    const ms = Date.now() - new Date(startTime).getTime();
    const s = Math.floor(ms / 1000);
    if (s < 60) return `${s}s`;
    const m = Math.floor(s / 60);
    if (m < 60) return `${m}m${s % 60}s`;
    return `${Math.floor(m / 60)}h${m % 60}m`;
  };

  if (!session) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="text-center space-y-2">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="mx-auto text-indigo-400/20">
            <circle cx="12" cy="12" r="3" /><path d="M12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2" />
          </svg>
          <p className="text-[9px] font-sans text-txt-tertiary">No active session</p>
        </div>
      </div>
    );
  }

  if (allAgents.length === 0) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="text-center space-y-2">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="mx-auto text-indigo-400/20">
            <circle cx="12" cy="12" r="10" /><path d="M8 12h8M12 8v8" />
          </svg>
          <p className="text-[9px] font-sans text-txt-secondary">No agents yet</p>
          <p className="text-[8px] font-sans text-txt-tertiary">Agents will appear here when subagents are dispatched</p>
        </div>
      </div>
    );
  }

  const svgW = ROOT_X + LEVEL_X + 200;
  const svgH = Math.max(allAgents.length * NODE_GAP + 40, 200);

  return (
    <div className="flex h-full">
      <div className={`${showPanel ? "w-[60%]" : "w-full"} h-full relative overflow-hidden cursor-grab active:cursor-grabbing transition-all duration-300`}
           onMouseDown={handleMouseDown} onMouseMove={handleMouseMove} onMouseUp={handleMouseUp} onMouseLeave={handleMouseUp} onWheel={handleWheel}>
        <svg viewBox={`0 0 ${svgW} ${svgH}`} className="w-full h-full"
             style={{ transform: `translate(${offset.x}px, ${offset.y}px) scale(${zoom})`, transformOrigin: "center" }}>

          <g className="cursor-pointer" onClick={() => setSelectedId(selectedId === "root" ? null : "root")}>
            <circle cx={ROOT_X} cy={rootY} r="14" fill="rgba(30,32,45,0.9)" stroke={selectedId === "root" ? "#818cf8" : "rgba(99,102,241,0.3)"} strokeWidth={selectedId === "root" ? 1.5 : 1} />
            <text x={ROOT_X} y={rootY + 1.5} textAnchor="middle" className="text-[5px] font-mono font-bold" fill="rgba(129,140,248,0.8)">ROOT</text>
            <text x={ROOT_X} y={rootY + 22} textAnchor="middle" className="text-[4px] font-mono" fill="rgba(255,255,255,0.4)">{session?.project?.replace(/^C--Users-[^-]+-/, "").replace(/-/g, "/").split("/").pop() || "session"}</text>
          </g>

          {allAgents.map((agent, i) => {
            const ax = ROOT_X + LEVEL_X;
            const ay = i * NODE_GAP + 20;
            const isSelected = selectedId === agent.id;
            const color = statusColor(agent.status);
            const label = agent.type || (agent.desc || "agent").slice(0, 20);
            const events = agentEvents[agent.id] || [];

            return (
              <g key={agent.id}>
                <line x1={ROOT_X + 14} y1={rootY} x2={ax - 12} y2={ay} stroke="rgba(255,255,255,0.08)" strokeWidth="0.8" />

                <g className="cursor-pointer" onClick={(e) => { e.stopPropagation(); setSelectedId(isSelected ? null : agent.id); }}>
                  {agent.status === "active" && (
                    <circle cx={ax} cy={ay} r="16" fill="none" stroke={color} strokeWidth="0.5" opacity="0.4">
                      <animate attributeName="r" values="14;18;14" dur="2s" repeatCount="indefinite" />
                      <animate attributeName="opacity" values="0.4;0.1;0.4" dur="2s" repeatCount="indefinite" />
                    </circle>
                  )}
                  <circle cx={ax} cy={ay} r="10" fill="rgba(15,16,24,0.9)" stroke={isSelected ? "#818cf8" : color} strokeWidth={isSelected ? 1.5 : 0.8} />
                  <circle cx={ax} cy={ay} r="3" fill={color} opacity="0.8" />

                  <text x={ax + 18} y={ay - 2} className="text-[5px] font-mono font-bold" fill="rgba(255,255,255,0.6)">{label}</text>
                  <text x={ax + 18} y={ay + 7} className="text-[4px] font-mono" fill="rgba(255,255,255,0.3)">
                    {agent.status === "active" ? elapsed(agent.startTime) : `${events.length} events`}
                  </text>
                </g>
              </g>
            );
          })}
        </svg>
      </div>

      {showPanel && (
        <div className="w-[40%] h-full border-l border-white/[0.08] flex flex-col" style={{ background: "rgba(6,7,12,0.95)" }}>
          <div className="flex items-center justify-between px-3 py-2.5 border-b border-white/[0.06]">
            <div className="flex items-center gap-2">
              {selectedId === "root" ? (
                <span className="text-[9px] font-sans font-bold text-indigo-300">Session Overview</span>
              ) : (
                <>
                  <div className="w-2 h-2 rounded-full" style={{ background: statusColor(selected?.status || "done") }} />
                  <span className="text-[9px] font-sans font-bold text-txt-primary">{selected?.type || selected?.desc || "Agent"}</span>
                  <span className={`text-[7px] font-mono px-1.5 py-0.5 rounded-full ${selected?.status === "active" ? "bg-green-500/15 text-green-300" : selected?.status === "failed" ? "bg-red-500/15 text-red-300" : "bg-indigo-500/15 text-indigo-300"}`}>
                    {selected?.status || "done"}
                  </span>
                </>
              )}
            </div>
            <button onClick={() => setSelectedId(null)} className="text-txt-tertiary hover:text-txt-secondary transition-colors">
              <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
            </button>
          </div>

          {selectedId === "root" ? (
            <div className="flex-1 overflow-y-auto px-3 py-3 space-y-3">
              <div className="grid grid-cols-2 gap-2">
                <div className="rounded-lg border border-white/[0.06] px-2.5 py-2" style={{ background: "rgba(255,255,255,0.02)" }}>
                  <span className="text-[7px] font-sans font-bold tracking-wider uppercase text-txt-tertiary">Tokens</span>
                  <p className="text-[11px] font-mono font-bold text-indigo-300 mt-0.5">{(metrics.tokens.input + metrics.tokens.output) >= 1000 ? `${((metrics.tokens.input + metrics.tokens.output) / 1000).toFixed(1)}k` : metrics.tokens.input + metrics.tokens.output}</p>
                </div>
                <div className="rounded-lg border border-white/[0.06] px-2.5 py-2" style={{ background: "rgba(255,255,255,0.02)" }}>
                  <span className="text-[7px] font-sans font-bold tracking-wider uppercase text-txt-tertiary">Cost</span>
                  <p className="text-[11px] font-mono font-bold text-emerald-300 mt-0.5">${metrics.cost.toFixed(2)}</p>
                </div>
                <div className="rounded-lg border border-white/[0.06] px-2.5 py-2" style={{ background: "rgba(255,255,255,0.02)" }}>
                  <span className="text-[7px] font-sans font-bold tracking-wider uppercase text-txt-tertiary">Agents</span>
                  <p className="text-[11px] font-mono font-bold text-cyan-300 mt-0.5">{allAgents.length}</p>
                </div>
                <div className="rounded-lg border border-white/[0.06] px-2.5 py-2" style={{ background: "rgba(255,255,255,0.02)" }}>
                  <span className="text-[7px] font-sans font-bold tracking-wider uppercase text-txt-tertiary">Turns</span>
                  <p className="text-[11px] font-mono font-bold text-violet-300 mt-0.5">{metrics.turns}</p>
                </div>
              </div>
              <div>
                <span className="text-[7px] font-sans font-bold tracking-wider uppercase text-txt-tertiary">All Agents</span>
                <div className="mt-2 space-y-1">
                  {allAgents.map(a => (
                    <div key={a.id} className="flex items-center gap-2 px-2 py-1.5 rounded-md hover:bg-white/[0.03] cursor-pointer" onClick={() => setSelectedId(a.id)}>
                      <div className="w-1.5 h-1.5 rounded-full" style={{ background: statusColor(a.status) }} />
                      <span className="text-[8px] font-mono text-txt-secondary flex-1 truncate">{a.type || a.desc || "agent"}</span>
                      <span className="text-[7px] font-mono text-txt-tertiary">{a.status}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          ) : selected ? (
            <div className="flex-1 overflow-y-auto px-3 py-3 space-y-3">
              <div className="flex items-center gap-3">
                <div className="text-[8px] font-mono text-txt-tertiary">{elapsed(selected.startTime)}</div>
                <div className="text-[8px] font-mono text-txt-tertiary">{(agentEvents[selected.id] || []).length} events</div>
              </div>
              {selected.desc && <p className="text-[8px] font-mono text-txt-secondary">{selected.desc}</p>}
              <div>
                <span className="text-[7px] font-sans font-bold tracking-wider uppercase text-txt-tertiary">Activity</span>
                <div className="mt-2 space-y-1 max-h-[300px] overflow-y-auto">
                  {(agentEvents[selected.id] || []).length === 0 && <p className="text-[8px] font-mono text-txt-tertiary">No events yet</p>}
                  {(agentEvents[selected.id] || []).map((ev, i) => (
                    <div key={i} className="px-2 py-1.5 rounded-md border border-white/[0.04]" style={{ background: "rgba(255,255,255,0.02)" }}>
                      <div className="flex items-center gap-1.5">
                        <span className={`text-[7px] font-mono ${ev.role === "assistant" ? "text-indigo-300/60" : "text-cyan-300/60"}`}>{ev.role}</span>
                        {ev.timestamp && <span className="text-[6px] font-mono text-txt-tertiary">{new Date(ev.timestamp).toLocaleTimeString()}</span>}
                      </div>
                      {ev.text && <p className="text-[8px] font-mono text-txt-secondary mt-0.5 line-clamp-3">{ev.text.slice(0, 200)}</p>}
                      {ev.toolUses && ev.toolUses.length > 0 && (
                        <div className="mt-0.5 flex flex-wrap gap-1">
                          {ev.toolUses.map((tu, j) => (
                            <span key={j} className="text-[6px] font-mono px-1 py-0.5 rounded bg-indigo-500/10 text-indigo-300/60">{tu.tool}</span>
                          ))}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </div>
              {selected.result && (
                <div>
                  <span className="text-[7px] font-sans font-bold tracking-wider uppercase text-txt-tertiary">Result</span>
                  <div className="mt-1 px-2 py-1.5 rounded-md border border-white/[0.04]" style={{ background: "rgba(255,255,255,0.02)" }}>
                    <p className="text-[8px] font-mono text-txt-secondary whitespace-pre-wrap">{selected.result.slice(0, 500)}{selected.result.length > 500 ? "..." : ""}</p>
                  </div>
                </div>
              )}
            </div>
          ) : null}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Wire AgentsView into the view rendering**

Replace the agents placeholder (from Task 2 Step 3) with the real component:

```tsx
            {activeView === "agents" && (
              <motion.div key="agents-view" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.25 }} className="flex-1 min-h-0">
                <AgentsView
                  activeAgents={metrics.activeSubagents || []}
                  completedAgents={completedAgents}
                  agentEvents={agentEvents}
                  session={session}
                  metrics={metrics}
                />
              </motion.div>
            )}
```

- [ ] **Step 3: Verify build**

Run: `npx next build`
Expected: Build succeeds

- [ ] **Step 4: Commit**

```bash
git add app/components/Dashboard.tsx
git commit -m "feat: add AgentsView with tree visualization and detail panel"
```

---

### Task 5: Manual Integration Test

- [ ] **Step 1: Start the app**

Run: `npm run start`
Expected: ModelScope launches, AGENTS tab visible in top nav (was MAP)

- [ ] **Step 2: Open AGENTS tab with no agents**

Click AGENTS.
Expected: Shows "No agents yet" placeholder (or "No active session" if no session)

- [ ] **Step 3: Trigger agent spawning**

Start a Claude Code session that dispatches subagents (e.g., using the brainstorming or subagent-driven-development skill).
Expected: Root node appears on the left, agent nodes fan out to the right with connecting lines. Active agents pulse green.

- [ ] **Step 4: Click root node**

Click the ROOT circle.
Expected: Side panel opens showing session metrics (tokens, cost, agents count, turns) and a list of all agents.

- [ ] **Step 5: Click an agent node**

Click an agent circle.
Expected: Side panel shows agent type, status badge, elapsed time, activity feed with events, and result when done.

- [ ] **Step 6: Dismiss panel**

Click X on the panel or press Escape.
Expected: Panel closes, tree re-centers to full width.

- [ ] **Step 7: Verify completed agents persist**

Wait for an agent to finish.
Expected: Node changes from green pulse to indigo (done). Still visible and clickable with result in panel.

- [ ] **Step 8: Commit final state**

```bash
git add -A
git commit -m "feat: AGENTS tab — complete"
```
