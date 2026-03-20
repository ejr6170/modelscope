# MAP View Expansion Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Transform the MAP view from a directory tree visualization into a layered intelligence map with real dependency edges, a live activity heatmap, and a decision flow trace.

**Architecture:** A server-side dependency parser extracts import/require edges from source files. The LogicMap component fetches this data alongside the existing directory tree, then renders three toggleable layers: dependency graph (default on), activity heatmap, and decision flow.

**Tech Stack:** Node.js `fs`/`path` for parsing, regex for import extraction, React SVG for rendering, existing socket.io server for the endpoint

---

## File Structure

| File | Action | Responsibility |
|------|--------|---------------|
| `src/dependency-parser.js` | Create | Walk project, extract imports, resolve paths, return graph |
| `server.js` | Modify | Add `/scan-dependencies` endpoint with caching |
| `app/components/Dashboard.tsx` | Modify | LogicMap: fetch deps, three toggle layers, toolbar, enhanced rendering |

---

### Task 1: Create Dependency Parser Module

**Files:**
- Create: `src/dependency-parser.js`

- [ ] **Step 1: Create the dependency parser**

Create `src/dependency-parser.js`:

```javascript
import fs from "fs";
import path from "path";

const EXCLUDE = new Set(["node_modules", ".git", ".next", "dist", "build", ".cache", "out", "ModelScope-Build"]);
const PARSEABLE = new Set(["ts", "tsx", "js", "jsx", "mjs", "css"]);

const IMPORT_RE = /import\s+.*?\s+from\s+['"]([^'"]+)['"]/g;
const REQUIRE_RE = /require\(\s*['"]([^'"]+)['"]\s*\)/g;
const REEXPORT_RE = /export\s+.*?\s+from\s+['"]([^'"]+)['"]/g;
const DYNAMIC_RE = /import\(\s*['"]([^'"]+)['"]\s*\)/g;
const CSS_IMPORT_RE = /@import\s+(?:url\(\s*)?['"]?([^'")\s;]+)['"]?\s*\)?/g;

const EXT_CHAIN = ["", ".ts", ".tsx", ".js", ".jsx", "/index.ts", "/index.tsx", "/index.js", "/index.jsx"];

function resolveImport(specifier, fromFile, rootDir) {
  if (!specifier.startsWith("./") && !specifier.startsWith("../")) return null;
  const fromDir = path.dirname(fromFile);
  const base = path.resolve(rootDir, fromDir, specifier);
  for (const ext of EXT_CHAIN) {
    const candidate = base + ext;
    try {
      if (fs.statSync(candidate).isFile()) {
        return path.relative(rootDir, candidate).replace(/\\/g, "/");
      }
    } catch {}
  }
  return null;
}

function extractImports(content, ext) {
  const results = [];
  const patterns = ext === "css"
    ? [{ re: CSS_IMPORT_RE, type: "css-import" }]
    : [
        { re: IMPORT_RE, type: "import" },
        { re: REQUIRE_RE, type: "require" },
        { re: REEXPORT_RE, type: "re-export" },
        { re: DYNAMIC_RE, type: "import" },
      ];

  for (const { re, type } of patterns) {
    re.lastIndex = 0;
    let match;
    while ((match = re.exec(content)) !== null) {
      results.push({ specifier: match[1], edgeType: type });
    }
  }
  return results;
}

function walkDir(dir, rootDir, depth = 0) {
  if (depth > 5) return [];
  const entries = [];
  try {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (EXCLUDE.has(entry.name) || entry.name.startsWith(".")) continue;
      const fullPath = path.join(dir, entry.name);
      const relPath = path.relative(rootDir, fullPath).replace(/\\/g, "/");
      if (entry.isDirectory()) {
        const children = walkDir(fullPath, rootDir, depth + 1);
        entries.push({ path: relPath, name: entry.name, type: "dir", children });
      } else {
        const ext = entry.name.split(".").pop() || "";
        let lines = 0;
        try { lines = fs.readFileSync(fullPath, "utf-8").split("\n").length; } catch {}
        entries.push({ path: relPath, name: entry.name, type: "file", ext, lines });
      }
    }
  } catch {}
  return entries;
}

function flattenEntries(entries, parentDir = "") {
  const nodes = [];
  for (const e of entries) {
    nodes.push({ id: e.path, name: e.name, path: e.path, type: e.type, ext: e.ext || "", lines: e.lines || 0, parentDir });
    if (e.type === "dir" && e.children) {
      nodes.push(...flattenEntries(e.children, e.path));
    }
  }
  return nodes;
}

export function parseDependencies(rootDir) {
  const tree = walkDir(rootDir, rootDir);
  const nodes = flattenEntries(tree);
  const edges = [];

  for (const node of nodes) {
    if (node.type !== "file" || !PARSEABLE.has(node.ext)) continue;
    const fullPath = path.join(rootDir, node.path);
    let content;
    try { content = fs.readFileSync(fullPath, "utf-8"); } catch { continue; }

    const imports = extractImports(content, node.ext);
    for (const { specifier, edgeType } of imports) {
      const resolved = resolveImport(specifier, node.path, rootDir);
      if (resolved && nodes.some(n => n.id === resolved)) {
        edges.push({ from: node.id, to: resolved, edgeType });
      }
    }
  }

  return { nodes, edges };
}
```

- [ ] **Step 2: Verify syntax**

Run: `node --check src/dependency-parser.js`
Expected: no output

- [ ] **Step 3: Smoke test**

Create `test-deps.js`:
```javascript
import { parseDependencies } from "./src/dependency-parser.js";
const result = parseDependencies(".");
console.log(`Nodes: ${result.nodes.length}, Edges: ${result.edges.length}`);
console.log("Sample edges:", result.edges.slice(0, 5));
```
Run: `node test-deps.js`
Expected: prints node/edge counts and sample edges showing real imports from the project. Delete `test-deps.js` after.

- [ ] **Step 4: Commit**

```bash
git add src/dependency-parser.js
git commit -m "feat: add dependency parser for import/require edge extraction"
```

---

### Task 2: Add Server Endpoint

**Files:**
- Modify: `server.js` (add endpoint after `/scan-directory` block, around line 116)

- [ ] **Step 1: Add import at top of server.js**

After the existing imports at the top of `server.js` (after the `import { getUsage, updateUsage, checkLogEntryForUsage } from "./src/usage-cache.js";` line), add:

```javascript
import { parseDependencies } from "./src/dependency-parser.js";
```

- [ ] **Step 2: Add the endpoint with caching**

After the `/scan-directory` endpoint block (after `return;` around line 116), add:

```javascript
  let depCache = null;
  let depCacheTime = 0;

  if (req.method === "GET" && req.url === "/scan-dependencies") {
    const now = Date.now();
    if (!depCache || now - depCacheTime > 10000) {
      const targetDir = path.resolve(".");
      depCache = parseDependencies(targetDir);
      depCacheTime = now;
    }
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify(depCache));
    return;
  }
```

Note: `depCache` and `depCacheTime` must be declared OUTSIDE the request handler. Move them to module scope (after the `const PORT = 3778;` line area) so they persist across requests:

```javascript
let depCache = null;
let depCacheTime = 0;
```

And the handler block inside the request handler becomes:

```javascript
  if (req.method === "GET" && req.url === "/scan-dependencies") {
    const now = Date.now();
    if (!depCache || now - depCacheTime > 10000) {
      depCache = parseDependencies(path.resolve("."));
      depCacheTime = now;
    }
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify(depCache));
    return;
  }
```

- [ ] **Step 3: Verify server starts**

Run: `node server.js &` then `curl http://localhost:3778/scan-dependencies | head -c 200`
Expected: JSON output starting with `{"nodes":[...`. Kill the server after.

- [ ] **Step 4: Commit**

```bash
git add server.js
git commit -m "feat: add /scan-dependencies endpoint with 10s cache"
```

---

### Task 3: Update LogicMap — Dependency Layer & Toolbar

**Files:**
- Modify: `app/components/Dashboard.tsx:1019-1242` (MapEdge interface, LogicMap component)

- [ ] **Step 1: Update MapEdge interface**

At line 1021, change:
```tsx
interface MapEdge { from: string; to: string; }
```
To:
```tsx
interface MapEdge { from: string; to: string; edgeType?: string; }
```

- [ ] **Step 2: Add dependency fetch and toggle state to LogicMap**

Inside the `LogicMap` function, after the existing `const [dragging, setDragging] = useState(false);` (line 1054), add:

```tsx
  const [depEdges, setDepEdges] = useState<MapEdge[]>([]);
  const [depsLayer, setDepsLayer] = useState(true);
  const [activityLayer, setActivityLayer] = useState(false);
  const [flowLayer, setFlowLayer] = useState(false);
```

After the existing `fetchTree` useEffect (line 1071), add:

```tsx
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
```

- [ ] **Step 3: Compute incoming edge counts for node sizing**

Inside the `useMemo` that computes `{ nodes, edges }` (line 1073), after the `return { nodes: visible, edges: visibleEdges };` line but before the closing of the useMemo, add a new memo for incoming counts. Actually, add a separate useMemo after the existing one:

```tsx
  const incomingCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const e of depEdges) {
      counts[e.to] = (counts[e.to] || 0) + 1;
    }
    return counts;
  }, [depEdges]);
```

- [ ] **Step 4: Update edge rendering to use dependency edges when DEPS is on**

In the SVG rendering section, find the existing edge rendering block (around line 1172-1177). Replace:

```tsx
        {edges.map((edge, i) => {
          const a = nodes.find(n => n.id === edge.from);
          const b = nodes.find(n => n.id === edge.to);
          if (!a || !b) return null;
          return <line key={i} x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke="rgba(129, 140, 248, 0.12)" strokeWidth="0.5" />;
        })}
```

With:

```tsx
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
```

- [ ] **Step 5: Update node radius to scale by incoming edges**

In the node rendering section (around line 1186), change:

```tsx
          const nodeRadius = isDir ? 8 : 5;
```

To:

```tsx
          const inc = incomingCounts[node.id] || 0;
          const nodeRadius = isDir ? 8 : Math.min(5 + inc * 1.5, 14);
```

- [ ] **Step 6: Add toolbar**

Replace the existing refresh button block (around line 1230-1232):

```tsx
      <button onClick={fetchTree} className="absolute top-2 right-2 w-6 h-6 flex items-center justify-center rounded-md bg-white/[0.04] hover:bg-white/[0.08] text-txt-tertiary hover:text-indigo-400 transition-colors" title="Refresh tree">
        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><polyline points="23 4 23 10 17 10" /><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10" /></svg>
      </button>
```

With:

```tsx
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
```

- [ ] **Step 7: Verify build**

Run: `npx next build`
Expected: Build succeeds

- [ ] **Step 8: Commit**

```bash
git add app/components/Dashboard.tsx
git commit -m "feat: add dependency edges, node scaling, and layer toggles to MAP"
```

---

### Task 4: Add Activity Heatmap Layer

**Files:**
- Modify: `app/components/Dashboard.tsx` (LogicMap component)

- [ ] **Step 1: Add activity score computation**

Inside the `LogicMap` function, after the `incomingCounts` useMemo, add:

```tsx
  const activityScores = useMemo(() => {
    if (!activityLayer) return {};
    const scores: Record<string, number> = {};
    const now = Date.now();
    for (const card of cards) {
      if (!card.filename) continue;
      const age = now - new Date(card.timestamp).getTime();
      const decay = age > 300000 ? 0.25 : age > 120000 ? 0.5 : 1;
      const weight = card.kind === "code" ? 3 : card.kind === "read" ? 1 : card.kind === "tool" ? 1 : 0;
      const key = card.filename;
      scores[key] = (scores[key] || 0) + weight * decay;
      const shortName = key.includes("/") ? key.split("/").pop()! : key;
      if (shortName !== key) scores[shortName] = (scores[shortName] || 0) + weight * decay;
    }
    return scores;
  }, [activityLayer, cards]);
```

- [ ] **Step 2: Add glow rendering to nodes**

In the node rendering `<g>` block, BEFORE the main `<circle>` element (around line 1194-1196), add after the existing recent/focus glow:

```tsx
              {activityLayer && (activityScores[node.id] || activityScores[node.name] || 0) > 0 && (
                <circle cx={node.x} cy={node.y} r={nodeRadius + 6} fill="none" stroke="rgba(251, 191, 36, 0.3)" strokeWidth="1.5" opacity={Math.min((activityScores[node.id] || activityScores[node.name] || 0) / 10, 1)}>
                  <animate attributeName="opacity" values={`${Math.min((activityScores[node.id] || activityScores[node.name] || 0) / 10, 1)};${Math.min((activityScores[node.id] || activityScores[node.name] || 0) / 15, 0.6)};${Math.min((activityScores[node.id] || activityScores[node.name] || 0) / 10, 1)}`} dur="2s" repeatCount="indefinite" />
                </circle>
              )}
```

- [ ] **Step 3: Add edge glow for active dependency chains**

In the dependency edge rendering (the `depsLayer` branch), update the opacity logic. Replace `opacity={isHovered ? 1 : 0.5}` with:

```tsx
opacity={isHovered ? 1 : (activityLayer && (activityScores[edge.from] || activityScores[edge.to]) ? 0.8 : 0.5)}
```

And increase strokeWidth when both endpoints are active:

```tsx
strokeWidth={isHovered ? 1.2 : (activityLayer && activityScores[edge.from] && activityScores[edge.to] ? 1 : 0.5)}
```

- [ ] **Step 4: Verify build**

Run: `npx next build`
Expected: Build succeeds

- [ ] **Step 5: Commit**

```bash
git add app/components/Dashboard.tsx
git commit -m "feat: add activity heatmap layer to MAP view"
```

---

### Task 5: Add Decision Flow Layer

**Files:**
- Modify: `app/components/Dashboard.tsx` (LogicMap component)

- [ ] **Step 1: Add flow path computation**

Inside `LogicMap`, after the `activityScores` useMemo, add:

```tsx
  const flowPath = useMemo(() => {
    if (!flowLayer) return [];
    const steps: { nodeId: string; cardId: string; label: string }[] = [];
    const recent = cards.slice(-20);
    for (const card of recent) {
      if (!card.filename) continue;
      const matchNode = nodes.find(n => n.id === card.filename || n.name === card.filename);
      if (!matchNode) continue;
      const label = card.kind === "code" ? `Edit: ${card.filename}` : card.kind === "read" ? `Read: ${card.filename}` : `${card.toolName || card.kind}: ${card.filename}`;
      steps.push({ nodeId: matchNode.id, cardId: card.id, label });
    }
    return steps;
  }, [flowLayer, cards, nodes]);
```

- [ ] **Step 2: Render the flow path in SVG**

Inside the SVG element, AFTER the node rendering block (after the closing `})}` of the nodes map, around line 1208), add:

```tsx
        {flowLayer && flowPath.length > 1 && flowPath.map((step, i) => {
          if (i === 0) return null;
          const prev = nodes.find(n => n.id === flowPath[i - 1].nodeId);
          const curr = nodes.find(n => n.id === step.nodeId);
          if (!prev || !curr) return null;
          const brightness = 0.3 + (i / flowPath.length) * 0.7;
          return (
            <g key={`flow-${i}`} className="cursor-pointer" onClick={(e) => { e.stopPropagation(); onJumpToCard(step.cardId); }}>
              <line x1={prev.x} y1={prev.y} x2={curr.x} y2={curr.y}
                stroke={`rgba(34, 211, 238, ${brightness})`} strokeWidth="1.5" strokeDasharray="4 3">
                <animate attributeName="stroke-dashoffset" from="0" to="-7" dur="1s" repeatCount="indefinite" />
              </line>
              <circle cx={(prev.x + curr.x) / 2} cy={(prev.y + curr.y) / 2} r="5" fill="rgba(10,10,25,0.9)" stroke={`rgba(34, 211, 238, ${brightness})`} strokeWidth="0.8" />
              <text x={(prev.x + curr.x) / 2} y={(prev.y + curr.y) / 2 + 1.5} textAnchor="middle" className="text-[3px] font-mono font-bold" fill={`rgba(34, 211, 238, ${brightness})`}>{i}</text>
              <title>{step.label}</title>
            </g>
          );
        })}
```

- [ ] **Step 3: Verify build**

Run: `npx next build`
Expected: Build succeeds

- [ ] **Step 4: Commit**

```bash
git add app/components/Dashboard.tsx
git commit -m "feat: add decision flow layer to MAP view"
```

---

### Task 6: Manual Integration Test

- [ ] **Step 1: Start the app**

Run: `npm run start`
Expected: ModelScope launches, MAP tab is available

- [ ] **Step 2: Open MAP tab and verify dependency edges**

Click MAP. DEPS toggle should be on by default.
Expected: Curved arrows connecting files that import each other, with arrowheads. Hub files (like Dashboard.tsx) should be visually larger.

- [ ] **Step 3: Toggle DEPS off and on**

Click DEPS to turn it off.
Expected: Edges revert to directory-tree containment lines. Click again — dependency arrows return.

- [ ] **Step 4: Toggle ACTIVITY on**

Click ACTIVITY while a session is active.
Expected: Recently touched files glow amber. Files not touched by the session have no glow. Dependency edges between active files are brighter.

- [ ] **Step 5: Toggle FLOW on**

Click FLOW.
Expected: Animated dashed cyan line traces through files in the order Claude touched them. Numbered badges show sequence. Clicking a badge jumps to FEED.

- [ ] **Step 6: All three toggles on**

Turn on DEPS + ACTIVITY + FLOW simultaneously.
Expected: Full layered view — structural dependencies, activity heat, and reasoning path overlaid.

- [ ] **Step 7: Commit final state**

```bash
git add -A
git commit -m "feat: MAP view expansion — complete"
```
