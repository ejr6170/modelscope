# MAP View Expansion — Design Spec

## Problem

The MAP view currently shows a directory tree rendered as a force-directed graph. Files are connected to their parent directories — there are no actual code relationships, no activity context, and no reasoning trace. It's a pretty visualization with no analytical value.

## Solution

Replace the directory-only graph with a layered intelligence map built on three toggleable layers:

1. **Dependency Graph** (default ON) — real import/require edges parsed from source files
2. **Activity Heatmap** (toggle) — live session activity overlaid as glow/pulse on nodes and edges
3. **Decision Flow** (toggle) — Claude's sequential path through files, showing reasoning order

## Design

### 1. Dependency Graph — Base Layer

**Server-side import parser:** A new module `src/dependency-parser.js` exports a function `parseDependencies(rootDir)`. It:

1. Walks the project directory (reuses existing directory scanning patterns, same `EXCLUDE` set)
2. For each `.ts`, `.tsx`, `.js`, `.jsx`, `.css` file, reads its content and extracts import targets using regex patterns that handle both quote styles:
   - JS/TS imports: `/import\s+.*?\s+from\s+['"]([^'"]+)['"]/g`
   - JS/TS require: `/require\(\s*['"]([^'"]+)['"]\s*\)/g`
   - JS/TS re-exports: `/export\s+.*?\s+from\s+['"]([^'"]+)['"]/g`
   - JS/TS dynamic imports: `/import\(\s*['"]([^'"]+)['"]\s*\)/g`
   - CSS imports: `/@import\s+(?:url\(\s*)?['"]?([^'")\s]+)['"]?\s*\)?/g`
3. Filters extracted specifiers: **only relative paths** (starting with `./` or `../`) are resolved. Bare specifiers (`react`, `socket.io-client`, etc.) and aliased paths (`@/...`) are skipped — they point outside the project and don't belong in the graph.
4. Resolves relative paths by trying extensions in order: exact match, `.ts`, `.tsx`, `.js`, `.jsx`, `/index.ts`, `/index.tsx`, `/index.js`, `/index.jsx`. First match wins.
5. Returns `{ nodes: [{ id, name, path, type, ext, lines, parentDir }], edges: [{ from, to, edgeType }] }` where `edgeType` is `"import"`, `"require"`, `"css-import"`, or `"re-export"`. Nodes include `parentDir` for directory clustering.

**Root directory:** The endpoint uses the same `path.resolve(".")` as the existing `/scan-directory`. This resolves to the project directory in development (where `npm run start` is called) and to the app bundle in production. The existing `/scan-directory` endpoint has this same limitation in production — fixing it is out of scope for this feature.

**New endpoint:** `GET /scan-dependencies` on the existing HTTP server (port 3778). Calls `parseDependencies(targetDir)` and returns the graph JSON. Results are cached for 10 seconds to avoid re-parsing on every request.

**Layout algorithm:** The existing `flattenTree` function and its polar layout logic remain. The `/scan-dependencies` response includes `parentDir` on each node so the same directory-cluster layout positions nodes. Dependency edges are drawn **on top of** the existing layout — they don't change node positions, only add new connections between nodes. The directory-tree edges (parent→child containment) are hidden when the DEPS toggle is on, replaced by dependency edges. When DEPS is off, the directory-tree edges reappear as fallback context.

**MAP rendering changes:**
- When DEPS is on: dependency arrows (importer → imported) replace directory containment edges
- When DEPS is off: directory-tree edges reappear (current behavior)
- Directory clusters still group files visually via background rectangles (always visible)
- Dependency edges drawn as curved SVG paths with small arrowheads, using `<marker>` defs
- Edge color by type: indigo for `import`, cyan for `require`, purple for CSS
- Edge opacity dimmed unless one connected node is hovered — hovering a node highlights all its incoming and outgoing edges

**Node sizing:** File nodes scale their radius by incoming dependency edge count. Files with many importers (hub files) are visually larger. Directory nodes remain fixed size.

### 2. Activity Heatmap — Toggle Layer

**Data source:** The `cards` prop already passed to LogicMap contains all session events with `filename`, `kind`, and `timestamp` fields. Note: the discriminator field is `kind` (of type `CardKind`), not `type`.

**Activity scoring per file:**
- `kind === "code"` (Write/Edit): +3
- `kind === "read"`: +1
- `kind === "tool"` referencing the file: +1
- Time decay: compare `new Date(card.timestamp).getTime()` to `Date.now()`. Cards older than 2 minutes get half weight, older than 5 minutes get quarter weight.

**Visual treatment when ON:**
- Node glow: radial gradient ring around each node, intensity proportional to activity score. No glow on dormant files. Amber/orange pulse on hot files.
- Edge glow: dependency edges between two active files brighten, showing live dependency chains
- Small flame indicator next to file name for files with score > 5

**Toggle:** "ACTIVITY" pill button in the MAP toolbar. Off by default.

**No server changes needed** — all data from existing `cards` prop.

### 3. Decision Flow — Toggle Layer

**Data source:** The `cards` prop, scanned in chronological order. Uses `cards.slice(-20)` to match the existing replay window convention.

**Flow construction:** Build an ordered sequence of file interactions from the cards:
- Card references file A (read) → file B (edit) → file C (read) → file B (edit)
- Becomes directed path: A → B → C → B
- Cards without a `filename` are skipped.

**Visual treatment when ON:**
- Animated dashed SVG path connecting nodes in sequence
- Each segment has a numbered badge (1, 2, 3...) showing order
- Line animates via `stroke-dashoffset` CSS — a flowing effect showing direction
- Color: cyan gradient, fading from dim (oldest step) to bright (newest)
- Non-file actions (Bash, thinking) show as small diamond waypoints on the path between file nodes

**Interactions:**
- Hover a flow segment: tooltip shows card summary (e.g., "Edit: added error handler")
- Click a flow segment: jumps to that card in FEED view via existing `onJumpToCard`

**Toggle:** "FLOW" pill button in the MAP toolbar. Off by default. Can be combined with ACTIVITY.

**No server changes needed** — all data from existing `cards` prop.

### 4. Toolbar

Three pill-style toggle buttons in the MAP's top-right area (next to the existing refresh button):

- **DEPS** — on by default, toggles dependency edges (off shows directory-tree edges as fallback)
- **ACTIVITY** — off by default, toggles heatmap glow
- **FLOW** — off by default, toggles decision path

Plus the existing refresh button.

Any combination of toggles is valid. With all three on, you see the structural graph with live activity heat and the reasoning path overlaid.

### 5. File Changes

**New files:**

- `src/dependency-parser.js` (~100 lines): ES module. Reads project files, extracts import/require/export/dynamic-import/CSS-import edges using regex that handles both single and double quotes. Filters to relative paths only. Resolves with extension fallback chain. Returns `{ nodes, edges }` with `parentDir` on nodes.

**Modified files:**

**`server.js` (~20 lines added):**
- Import `parseDependencies` from `./src/dependency-parser.js`
- Add `GET /scan-dependencies` endpoint with 10-second cache
- Response shape: `{ nodes: [...], edges: [{ from, to, edgeType }] }`

**`app/components/Dashboard.tsx` — LogicMap component (~150 lines changed):**
- Fetch from `/scan-dependencies` in addition to `/scan-directory`
- When DEPS toggle is on: render dependency edges (curved, directed, arrowheads). When off: render directory-tree edges (current behavior)
- Scale node radius by incoming edge count
- Add `depsLayer` (default true), `activityLayer`, and `flowLayer` boolean state
- When `activityLayer` is on: compute activity scores from `cards` using `card.kind`, render glow/pulse on nodes and edges
- When `flowLayer` is on: build sequential path from `cards.slice(-20)`, render animated dashed line with numbered steps
- Add toolbar with DEPS/ACTIVITY/FLOW toggles alongside refresh button
- Update `MapEdge` interface to include optional `edgeType` field
- Keep: zoom, pan, collapse/expand, hover tooltip, click-to-jump, file targeting, extension color coding, `flattenTree`, polar layout

**No changes to:** `electron/main.js`, `electron/preload.cjs`, `app/globals.css`, sidebar, settings, FEED, MONITOR, CommandBar

### 6. What This Does NOT Change

- Feed view — unchanged
- MONITOR view — unchanged
- Sidebar metrics — unchanged
- Command bar — unchanged
- Server session watching, socket.io events — unchanged

### 7. Future Extension (Out of Scope)

- TypeScript path alias resolution (`@/...` mappings from tsconfig)
- Circular dependency detection and warnings
- Cross-project dependency tracking
- File change impact prediction ("if you edit X, these files may break")
- Persisting dependency graph across sessions
- Export graph as image or SVG
