# Hardware Metrics — Design Spec

## Problem

ModelScope monitors Claude Code sessions at the token/cost/tool level but has no visibility into the physical machine resources being consumed. Users running long sessions with multiple agents have no way to see CPU, memory, or GPU impact without switching to Task Manager or a separate monitoring tool.

## Solution

Add hardware usage metrics to ModelScope in two places: a compact always-visible summary pinned to the bottom of the right sidebar, and a full MONITOR tab (replacing the disabled ARCHIVE stub) with system gauges, a process tree showing all Claude agents, and a session history chart.

## Design

### 1. Data Collection — `src/hardware-monitor.js`

A standalone module that runs in the Electron main process. Polls every 2.5 seconds.

**System-wide metrics:**

- CPU: overall utilization % calculated from `os.cpus()` idle-vs-total delta between two consecutive polls
- Memory: used/total in GB from `os.totalmem()` and `os.freemem()`
- GPU: detected at startup by checking PATH for `nvidia-smi`, `rocm-smi`, or `xpu-smi`. If found, queries utilization %, VRAM used/total, temperature, and GPU name. If none found, GPU data is `null` and the UI hides GPU sections entirely.

**Per-process metrics:**

- Walks the process tree starting from known Claude Code PIDs (from node-pty spawn or tracked session processes)
- Windows: `wmic process where "ParentProcessId=<PID>" get ProcessId,Name,WorkingSetSize` (recursive)
- Unix: `ps -o pid,ppid,pcpu,rss,comm` filtered by parent PID chain
- Each process: PID, name, CPU %, memory MB
- Subagents identified by matching PIDs against the `activeSubagents` data the server already tracks

**Module API:**

```javascript
class HardwareMonitor {
  start(intervalMs)    // begin polling
  stop()               // stop polling, clear timers
  onData(callback)     // register listener for metrics updates
}
```

**Data shape (IPC event `hardware-metrics`):**

```
{
  cpu: { percent: number },
  memory: { usedGB: number, totalGB: number, percent: number },
  gpu: {
    available: boolean,
    name?: string,
    utilPercent?: number,
    vramUsedMB?: number,
    vramTotalMB?: number,
    tempC?: number
  } | null,
  processes: [{
    pid: number,
    name: string,
    cpuPercent: number,
    memoryMB: number,
    isAgent: boolean,
    agentType?: string,
    parentPid?: number
  }]
}
```

### 2. Right Sidebar — Split View

The existing `Sidebar` component gains a pinned bottom zone below the current scrollable content.

**Layout:**

- Top zone (flex-1, overflow-y auto): all existing metrics unchanged — plan, usage, tokens, velocity, cost, active agents, hot files, project info
- Divider: `border-t border-white/[0.06]`
- Bottom zone (fixed ~140px, no scroll): hardware summary gauges

**Bottom zone content:**

- Three compact horizontal bars or ring gauges side by side: CPU %, Memory %, GPU % (conditional)
- Each shows current value as a number and a fill bar
- GPU gauge only renders when `gpu.available === true`
- Below the gauges: a small label like "3 processes" linking mentally to the MONITOR tab

**The bottom zone stays pinned** — it does not scroll with the rest of the sidebar content.

### 3. MONITOR Tab (Full Hardware View)

The disabled "ARCHIVE" button in the StatusBar is renamed to "MONITOR" and enabled. When selected, it renders a full-width content view in the center panel (same area as FEED and MAP).

**Three sections, vertically stacked, scrollable:**

**Section 1 — System Overview:**

- Three larger gauge cards side by side: CPU, Memory, GPU
- Each card: current value, mini sparkline (last 60 data points ≈ 2.5 minutes of history), peak value during the session
- GPU card: GPU name (e.g., "RTX 4070"), utilization %, VRAM bar (used/total), temperature in °C
- If no GPU detected, only CPU and Memory cards render (two-column layout)

**Section 2 — Process Tree:**

- Tree view rooted at the Claude Code session process, child agents/subagents nested underneath
- Each row: PID, process name, agent type (from `activeSubagents` tracking), CPU %, memory MB
- Live-updating — rows appear/disappear as agents spawn and exit
- Agent rows highlighted with indigo accent, non-agent child processes dimmed
- Expandable/collapsible tree nodes

**Section 3 — History Chart:**

- Line chart showing CPU % and memory % over session duration
- Stores last 120 data points (≈ 5 minutes at 2.5s intervals)
- Rendered as SVG `<polyline>` — no charting library, matches the existing SVG-based approach used in LogicMap
- Two lines: CPU in cyan, memory in indigo
- Y-axis 0–100%, X-axis is time (relative, "5m ago" → "now")

**Sparkline storage:** The `Dashboard` component maintains a `hardwareHistory` array (max 120 entries) that the MONITOR view's sparklines and history chart read from.

### 4. File Changes

**New files:**

- `src/hardware-monitor.js` (~150 lines): data collection class with polling, process tree walking, GPU detection

**Modified files:**

**`electron/main.js` (~15 lines added):**

- Import `HardwareMonitor` from `../src/hardware-monitor.js`
- Instantiate after window ready, call `start(2500)`
- Forward data to renderer via `mainWindow.webContents.send("hardware-metrics", data)` in `onData` callback
- Call `stop()` on `window-all-closed`

**`electron/preload.cjs` (~4 lines added):**

- Add `onHardwareMetrics(callback)` — listens to `hardware-metrics` IPC
- Add `removeHardwareMetrics()` — removes listeners

**`app/components/Dashboard.tsx` (~250 lines added):**

- Root `Dashboard`: add `hardwareMetrics` state + `hardwareHistory` array (max 120), wire IPC listener
- `Sidebar`: accept `hardwareMetrics` prop, render pinned bottom zone with compact gauges
- `StatusBar`: rename "ARCHIVE" to "MONITOR", set `enabled: true`
- New `MonitorView` component: system overview gauges, process tree, SVG history chart
- `MonitorView` receives `hardwareMetrics` (current) and `hardwareHistory` (array) as props

**`app/globals.css` (~10 lines added):**

- Gauge ring/bar animation keyframes

**No changes to:** `server.js`, `src/parser.js`, `src/usage-cache.js`, `src/watcher.js`, feed logic, settings, LogicMap, CommandBar

### 5. What This Does NOT Change

- Token/cost/velocity metrics — unchanged
- Feed view, MAP view — unchanged
- Command bar and session management — unchanged
- Socket.io server and session watching — unchanged
- Auto-updater — unchanged

### 6. Future Extension (Out of Scope)

- Disk I/O metrics
- Network usage per process
- Hardware alerts/thresholds (e.g., "CPU > 90% for 30s")
- Historical data persistence across app restarts
- Remote machine monitoring
