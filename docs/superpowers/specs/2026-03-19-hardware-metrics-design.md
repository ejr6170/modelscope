# Hardware Metrics — Design Spec

## Problem

ModelScope monitors Claude Code sessions at the token/cost/tool level but has no visibility into the physical machine resources being consumed. Users running long sessions with multiple agents have no way to see CPU, memory, or GPU impact without switching to Task Manager or a separate monitoring tool.

## Solution

Add hardware usage metrics to ModelScope in two places: a compact always-visible summary pinned to the bottom of the right sidebar, and a full MONITOR tab (replacing the disabled ARCHIVE stub) with system gauges, a process tree showing all Claude processes, and a session history chart.

## Design

### 1. Data Collection — `src/hardware-monitor.js`

A standalone ES module (`export default class HardwareMonitor`) that runs in the Electron main process. Imported in `main.js` via standard `import`. Polls every 2.5 seconds.

**System-wide metrics:**

- CPU: overall utilization % calculated from `os.cpus()` — sum idle and total times across all cores, compute the delta ratio between two consecutive polls
- Memory: used/total in GB from `os.totalmem()` and `os.freemem()`
- GPU: detected at startup. On Windows, try `nvidia-smi` at both PATH and `C:\Windows\System32\nvidia-smi.exe` fallback. On Unix, check PATH for `nvidia-smi`, `rocm-smi`, or `xpu-smi`. If found, queries utilization %, VRAM used/total, temperature, and GPU name. If none found, GPU data is `null` and the UI hides GPU sections entirely. Each GPU poll is wrapped in try/catch — on failure, emit `gpu: null` and re-attempt detection on next poll.

**Per-process metrics:**

- The monitor exposes a `setRootPid(pid)` method. When set, it walks the process tree from that PID. When not set, it uses `process.pid` (the Electron process) as the root.
- `main.js` calls `setRootPid(ptyProcess.pid)` when a session starts and `setRootPid(null)` when it ends.
- Windows: `powershell -NoProfile -Command "Get-CimInstance Win32_Process | Select-Object ProcessId,ParentProcessId,Name,WorkingSetSize | ConvertTo-Json"` — parse JSON, filter to descendants of root PID recursively. Windows ARM (`process.arch === "arm64"` on `win32`): skip per-process metrics, return empty array.
- Unix: `ps -eo pid,ppid,pcpu,rss,comm` — filter by parent PID chain
- Each process: PID, name, CPU %, memory MB, parentPid
- `isAgent` and `agentType` are NOT populated from `activeSubagents` (those track tool-use IDs, not OS PIDs). Instead, processes are simply shown as a tree. Agent identification is a future extension.

**Module API:**

```javascript
export default class HardwareMonitor {
  start(intervalMs)       // begin polling
  stop()                  // stop polling, clear timers
  setRootPid(pid | null)  // set root PID for process tree, null = use Electron PID
  onData(callback)        // register listener for metrics updates
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
    parentPid: number
  }]
}
```

### 2. Right Sidebar — Split View

The existing `Sidebar` component is restructured to pin a hardware zone at the bottom.

**DOM structure change:** The current Sidebar root is a single `flex-col overflow-y-auto` div. This must be split into:

```
<div className="flex flex-col h-full">           <!-- outer container, no overflow -->
  <div className="flex-1 overflow-y-auto ...">    <!-- inner scrollable zone: all existing content -->
    ...existing metrics, agents, hot files, project...
  </div>
  <div className="border-t border-white/[0.06]" /> <!-- divider -->
  <div className="shrink-0 px-3 py-3">            <!-- pinned hardware zone, ~140px -->
    ...compact gauges...
  </div>
</div>
```

**Bottom zone content:**

- Three compact horizontal bars side by side: CPU %, Memory %, GPU % (conditional)
- Each shows current value as a number and a fill bar
- GPU gauge only renders when `gpu.available === true`
- Below the gauges: a small label like "3 processes" as a visual hint toward the MONITOR tab

### 3. MONITOR Tab (Full Hardware View)

The disabled "ARCHIVE" button in the StatusBar is changed: `id` changes from `"archive"` to `"monitor"`, `label` changes from `"ARCHIVE"` to `"MONITOR"`, and `enabled` is set to `true`. When `activeView === "monitor"`, a `MonitorView` component renders in the center panel.

**Three sections, vertically stacked, scrollable:**

**Section 1 — System Overview:**

- Three larger gauge cards side by side: CPU, Memory, GPU
- Each card: current value, mini sparkline showing the last 60 entries of `hardwareHistory` (≈ 2.5 minutes), peak value during the session
- GPU card: GPU name (e.g., "RTX 4070"), utilization %, VRAM bar (used/total), temperature in °C
- If no GPU detected, only CPU and Memory cards render (two-column layout)

**Section 2 — Process Tree:**

- Tree view rooted at the root PID, child processes nested underneath by `parentPid`
- Each row: PID, process name, CPU %, memory MB
- Live-updating — rows appear/disappear as processes spawn and exit
- Expandable/collapsible tree nodes

**Section 3 — History Chart:**

- Line chart showing CPU % and memory % over session duration
- Uses the full `hardwareHistory` array (max 120 entries ≈ 5 minutes at 2.5s intervals)
- Rendered as SVG `<polyline>` — no charting library, matches the existing SVG-based approach used in LogicMap
- Two lines: CPU in cyan, memory in indigo
- Y-axis 0–100%, X-axis is time (relative, "5m ago" → "now")

**Sparkline vs history:** The gauge card sparklines use `hardwareHistory.slice(-60)` (last 2.5 minutes). The history chart uses the full 120-entry array (last 5 minutes).

### 4. File Changes

**New files:**

- `src/hardware-monitor.js` (~150 lines): ES module, data collection class with polling, process tree walking, GPU detection

**Modified files:**

**`electron/main.js` (~15 lines added):**

- `let hardwareMonitor = null;` declared at module scope alongside `mainWindow` and `serverProcess`
- Inside `createWindow`, after `ready-to-show`: instantiate `HardwareMonitor`, call `start(2500)`, wire `onData` to forward via `mainWindow.webContents.send("hardware-metrics", data)`
- When pty session starts: `hardwareMonitor.setRootPid(ptyProcess.pid)`
- When pty session ends: `hardwareMonitor.setRootPid(null)`
- In `window-all-closed`: `hardwareMonitor?.stop()`

**`electron/preload.cjs` (~4 lines added):**

- Add `onHardwareMetrics(callback)` — listens to `hardware-metrics` IPC
- Add `removeHardwareMetrics()` — removes listeners

**`app/components/Dashboard.tsx` (~250 lines added):**

- Root `Dashboard`: add `hardwareMetrics` state + `hardwareHistory` array (max 120), wire IPC listener
- `Sidebar`: accept `hardwareMetrics` prop, restructure DOM to pin bottom zone, render compact gauges
- `StatusBar`: change ARCHIVE button `id` to `"monitor"`, `label` to `"MONITOR"`, `enabled` to `true`
- New `MonitorView` component: system overview gauges with sparklines, process tree, SVG history chart
- `MonitorView` receives `hardwareMetrics` (current) and `hardwareHistory` (array) as props

**`app/globals.css` (~10 lines added):**

- Gauge bar animation keyframes

**No changes to:** `server.js`, `src/parser.js`, `src/usage-cache.js`, `src/watcher.js`, feed logic, settings, LogicMap, CommandBar

### 5. What This Does NOT Change

- Token/cost/velocity metrics — unchanged
- Feed view, MAP view — unchanged
- Command bar and session management — unchanged
- Socket.io server and session watching — unchanged
- Auto-updater — unchanged

### 6. Future Extension (Out of Scope)

- Agent type identification (correlating OS PIDs with `activeSubagents` tool-use IDs)
- Disk I/O metrics
- Network usage per process
- Hardware alerts/thresholds (e.g., "CPU > 90% for 30s")
- Historical data persistence across app restarts
- Remote machine monitoring
- Windows ARM per-process metrics
