# Hardware Metrics Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add real-time CPU, memory, GPU, and per-process hardware metrics to ModelScope's sidebar and a new MONITOR tab.

**Architecture:** A `HardwareMonitor` class in the main process polls system metrics every 2.5s using Node's `os` module, shell commands for process trees, and GPU CLI tools. Data flows via IPC to the renderer, which displays compact gauges in the sidebar and a full dashboard in the MONITOR tab.

**Tech Stack:** Node.js `os` module, `child_process.execSync`, PowerShell (Windows), `ps` (Unix), `nvidia-smi`/`rocm-smi`/`xpu-smi` for GPU, React SVG for charts

---

## File Structure

| File | Action | Responsibility |
|------|--------|---------------|
| `src/hardware-monitor.js` | Create | CPU/memory/GPU/process polling, data collection class |
| `electron/main.js` | Modify | Instantiate monitor, wire IPC, connect PID tracking |
| `electron/preload.cjs` | Modify | Add hardware metrics bridge methods |
| `app/globals.css` | Modify | Gauge animation keyframes |
| `app/components/Dashboard.tsx` | Modify | Sidebar hardware zone, MONITOR tab, MonitorView component |

---

### Task 1: Create HardwareMonitor Module

**Files:**
- Create: `src/hardware-monitor.js`

- [ ] **Step 1: Create the hardware monitor module**

Create `src/hardware-monitor.js` with the complete implementation:

```javascript
import os from "os";
import { execSync } from "child_process";

export default class HardwareMonitor {
  constructor() {
    this._interval = null;
    this._callback = null;
    this._rootPid = null;
    this._prevCpuTimes = null;
    this._gpuCmd = null;
    this._gpuDetected = false;
    this._detectGpu();
  }

  start(intervalMs) {
    if (this._interval) return;
    this._prevCpuTimes = this._getCpuTimes();
    this._interval = setInterval(() => this._poll(), intervalMs);
    this._poll();
  }

  stop() {
    if (this._interval) {
      clearInterval(this._interval);
      this._interval = null;
    }
  }

  setRootPid(pid) {
    this._rootPid = pid;
  }

  onData(callback) {
    this._callback = callback;
  }

  _getCpuTimes() {
    const cpus = os.cpus();
    let idle = 0;
    let total = 0;
    for (const cpu of cpus) {
      idle += cpu.times.idle;
      total += cpu.times.user + cpu.times.nice + cpu.times.sys + cpu.times.idle + cpu.times.irq;
    }
    return { idle, total };
  }

  _getCpuPercent() {
    const now = this._getCpuTimes();
    if (!this._prevCpuTimes) {
      this._prevCpuTimes = now;
      return 0;
    }
    const idleDelta = now.idle - this._prevCpuTimes.idle;
    const totalDelta = now.total - this._prevCpuTimes.total;
    this._prevCpuTimes = now;
    if (totalDelta === 0) return 0;
    return Math.round((1 - idleDelta / totalDelta) * 100);
  }

  _getMemory() {
    const totalGB = +(os.totalmem() / 1073741824).toFixed(1);
    const freeGB = +(os.freemem() / 1073741824).toFixed(1);
    const usedGB = +(totalGB - freeGB).toFixed(1);
    const percent = Math.round((usedGB / totalGB) * 100);
    return { usedGB, totalGB, percent };
  }

  _detectGpu() {
    const cmds = [];
    if (process.platform === "win32") {
      cmds.push("nvidia-smi");
      cmds.push("C:\\Windows\\System32\\nvidia-smi.exe");
    } else {
      cmds.push("nvidia-smi", "rocm-smi", "xpu-smi");
    }
    for (const cmd of cmds) {
      try {
        execSync(cmd + " --version", { stdio: "pipe", timeout: 3000 });
        this._gpuCmd = cmd;
        this._gpuDetected = true;
        return;
      } catch {}
    }
    this._gpuDetected = false;
  }

  _getGpu() {
    if (!this._gpuDetected || !this._gpuCmd) return null;
    try {
      if (this._gpuCmd.includes("nvidia-smi")) {
        const out = execSync(
          this._gpuCmd + " --query-gpu=name,utilization.gpu,memory.used,memory.total,temperature.gpu --format=csv,noheader,nounits",
          { stdio: "pipe", timeout: 3000, encoding: "utf8" }
        );
        const parts = out.trim().split(",").map(s => s.trim());
        if (parts.length >= 5) {
          return {
            available: true,
            name: parts[0],
            utilPercent: parseInt(parts[1]) || 0,
            vramUsedMB: parseInt(parts[2]) || 0,
            vramTotalMB: parseInt(parts[3]) || 0,
            tempC: parseInt(parts[4]) || 0,
          };
        }
      }
      if (this._gpuCmd.includes("rocm-smi")) {
        const out = execSync("rocm-smi --showuse --showtemp --showmeminfo vram --csv", { stdio: "pipe", timeout: 3000, encoding: "utf8" });
        const lines = out.trim().split("\n");
        if (lines.length >= 2) {
          return { available: true, name: "AMD GPU", utilPercent: 0, vramUsedMB: 0, vramTotalMB: 0, tempC: 0 };
        }
      }
    } catch {
      return null;
    }
    return null;
  }

  _getProcesses() {
    const rootPid = this._rootPid || process.pid;
    try {
      if (process.platform === "win32") {
        if (process.arch === "arm64") return [];
        const out = execSync(
          'powershell -NoProfile -Command "Get-CimInstance Win32_Process | Select-Object ProcessId,ParentProcessId,Name,WorkingSetSize | ConvertTo-Json"',
          { stdio: "pipe", timeout: 5000, encoding: "utf8" }
        );
        const allProcs = JSON.parse(out);
        if (!Array.isArray(allProcs)) return [];
        return this._filterDescendants(allProcs.map(p => ({
          pid: p.ProcessId,
          parentPid: p.ParentProcessId,
          name: p.Name || "",
          memoryMB: Math.round((p.WorkingSetSize || 0) / 1048576),
          cpuPercent: 0,
        })), rootPid);
      } else {
        const out = execSync("ps -eo pid,ppid,pcpu,rss,comm", { stdio: "pipe", timeout: 3000, encoding: "utf8" });
        const lines = out.trim().split("\n").slice(1);
        const allProcs = lines.map(line => {
          const parts = line.trim().split(/\s+/);
          return {
            pid: parseInt(parts[0]),
            parentPid: parseInt(parts[1]),
            cpuPercent: parseFloat(parts[2]) || 0,
            memoryMB: Math.round((parseInt(parts[3]) || 0) / 1024),
            name: parts.slice(4).join(" "),
          };
        });
        return this._filterDescendants(allProcs, rootPid);
      }
    } catch {
      return [];
    }
  }

  _filterDescendants(allProcs, rootPid) {
    const pids = new Set([rootPid]);
    let added = true;
    while (added) {
      added = false;
      for (const p of allProcs) {
        if (!pids.has(p.pid) && pids.has(p.parentPid)) {
          pids.add(p.pid);
          added = true;
        }
      }
    }
    return allProcs.filter(p => pids.has(p.pid));
  }

  _poll() {
    const data = {
      cpu: { percent: this._getCpuPercent() },
      memory: this._getMemory(),
      gpu: this._getGpu(),
      processes: this._getProcesses(),
    };
    if (this._callback) this._callback(data);
  }
}
```

- [ ] **Step 2: Verify the module parses**

Run: `node --check src/hardware-monitor.js`
Expected: no output (clean parse)

- [ ] **Step 3: Quick smoke test**

Create a temp file `test-hw.js`:
```javascript
import HardwareMonitor from "./src/hardware-monitor.js";
const h = new HardwareMonitor();
h.onData(d => { console.log(JSON.stringify(d, null, 2)); h.stop(); });
h.start(1000);
```
Run: `node test-hw.js`
Expected: prints JSON with cpu, memory, gpu, processes fields. Delete `test-hw.js` after.

- [ ] **Step 4: Commit**

```bash
git add src/hardware-monitor.js
git commit -m "feat: add hardware monitor data collection module"
```

---

### Task 2: Wire Main Process & Preload Bridge

**Files:**
- Modify: `electron/main.js:14-15` (add module-scope variable)
- Modify: `electron/main.js:9` (add import)
- Modify: `electron/main.js` inside `createWindow` (instantiate after ready-to-show)
- Modify: `electron/main.js` inside `window-all-closed` handler
- Modify: `electron/preload.cjs:23` (add two lines before closing `});`)

- [ ] **Step 1: Add import and module-scope variable to main.js**

At the top of the file, add this import alongside the existing imports (after line 5, `import { fork } from "child_process";`):

```javascript
import HardwareMonitor from "../src/hardware-monitor.js";
```

**IMPORTANT:** `import` declarations must be at the top of the file in ESM — do NOT place it after the `const require = ...` lines.

After line 15 (`let serverProcess = null;`), add:

```javascript
let hardwareMonitor = null;
```

- [ ] **Step 2: Instantiate monitor after ready-to-show**

Inside `createWindow`, after the `mainWindow.once("ready-to-show", ...)` block (after line 79), add:

```javascript
  hardwareMonitor = new HardwareMonitor();
  hardwareMonitor.onData((data) => {
    mainWindow?.webContents.send("hardware-metrics", data);
  });
  hardwareMonitor.start(2500);
```

- [ ] **Step 3: Connect PID tracking to pty lifecycle**

In the `start-session` handler (or `send-prompt` handler — whichever spawns the pty), after `ptyProcess` is assigned, add:

```javascript
    if (hardwareMonitor) hardwareMonitor.setRootPid(ptyProcess.pid);
```

In the `onExit` callback of the pty (line 156), add after `ptyProcess = null;`:

```javascript
      if (hardwareMonitor) hardwareMonitor.setRootPid(null);
```

**ALSO** in the `cancel-command` handler (line 168), add after `ptyProcess = null;`:

```javascript
    if (hardwareMonitor) hardwareMonitor.setRootPid(null);
```

Both exit paths must clear the PID — missing either one leaves stale process tracking.

- [ ] **Step 4: Stop monitor on app quit**

In the `window-all-closed` handler, before `app.quit()`, add:

```javascript
  if (hardwareMonitor) {
    hardwareMonitor.stop();
    hardwareMonitor = null;
  }
```

- [ ] **Step 5: Add preload bridge methods**

In `electron/preload.cjs`, before the closing `});` on line 24, add:

```javascript
  onHardwareMetrics: (callback) => ipcRenderer.on("hardware-metrics", (_e, data) => callback(data)),
  removeHardwareMetrics: () => ipcRenderer.removeAllListeners("hardware-metrics"),
```

- [ ] **Step 6: Verify main.js parses**

Run: `node --check electron/main.js`
Expected: no output (clean parse)

- [ ] **Step 7: Commit**

```bash
git add electron/main.js electron/preload.cjs
git commit -m "feat: wire hardware monitor to IPC bridge"
```

---

### Task 3: Add CSS Animations

**Files:**
- Modify: `app/globals.css` (insert after `.cmd-permission` block, after line 104)

- [ ] **Step 1: Add gauge animations**

After line 104 (the closing `}` of `.cmd-permission`), add:

```css
@keyframes gauge-fill {
  from { width: 0; }
}
.gauge-bar {
  animation: gauge-fill 0.6s ease-out;
}

@keyframes status-pulse {
  0%, 100% { opacity: 0.6; }
  50% { opacity: 1; }
}
.gauge-pulse {
  animation: status-pulse 2s ease-in-out infinite;
}
```

- [ ] **Step 2: Commit**

```bash
git add app/globals.css
git commit -m "feat: add hardware gauge CSS animations"
```

---

### Task 4: Restructure Sidebar with Hardware Zone

**Files:**
- Modify: `app/components/Dashboard.tsx:1246-1408` (Sidebar component)
- Modify: `app/components/Dashboard.tsx:2102` (Sidebar usage — add prop)

- [ ] **Step 1: Update Sidebar function signature**

At line 1246, change the Sidebar function signature to accept `hardwareMetrics`:

```tsx
function Sidebar({ metrics, model, session, onReset, fileTargets, onCycleTarget, snipedCount, hardwareMetrics }: { metrics: Metrics; model: string; session: SessionInfo | null; onReset?: () => void; fileTargets?: Record<string, string>; onCycleTarget?: (file: string) => void; snipedCount?: number; hardwareMetrics?: { cpu: { percent: number }; memory: { usedGB: number; totalGB: number; percent: number }; gpu: { available: boolean; name?: string; utilPercent?: number; vramUsedMB?: number; vramTotalMB?: number; tempC?: number } | null; processes: { pid: number; name: string; cpuPercent: number; memoryMB: number; parentPid: number }[] } | null }) {
```

- [ ] **Step 2: Restructure Sidebar DOM**

The Sidebar currently has ONE root div that scrolls. We need TWO: an outer non-scrolling container and an inner scrolling zone, so the hardware gauges stay pinned at the bottom.

**Step 2a:** Replace the Sidebar's root div opening (line 1263-1264):

```tsx
    <div className="w-full h-full flex flex-col py-4 px-3 gap-4 overflow-y-auto" style={{ background: "var(--sidebar-bg)", backdropFilter: "blur(50px) saturate(160%)" }}>
```

With TWO opening divs:

```tsx
    <div className="w-full h-full flex flex-col" style={{ background: "var(--sidebar-bg)", backdropFilter: "blur(50px) saturate(160%)" }}>
      <div className="flex-1 overflow-y-auto py-4 px-3 gap-4 flex flex-col">
```

**Step 2b:** The existing final `</div>` at line 1406 currently closes the single root div. It now closes the INNER scrolling div. Insert the hardware zone and the OUTER closing `</div>` before the Sidebar's `);` return statement:

Before the existing `</div>` at line 1406, add `</div>` to close the inner div, then the hardware zone, then the outer div closes via the existing `</div>`. The final structure is:

```
<div outer>          ← new outer container
  <div inner scroll> ← moved from old root
    ...all existing content...
  </div>             ← closes inner (was the old closing div)
  {hardware zone}    ← new content inserted here
</div>               ← closes outer (new closing div needed)
```

Insert the following before the Sidebar's return closing (replace the single `</div>` with):

```tsx
      </div>
      {hardwareMetrics && (
        <div className="shrink-0 border-t border-white/[0.06] px-3 py-3">
          <span className="text-[7px] font-sans font-bold tracking-[0.2em] uppercase text-txt-tertiary mb-2 block">SYSTEM</span>
          <div className="space-y-2">
            <div>
              <div className="flex items-center justify-between mb-0.5">
                <span className="text-[8px] font-mono text-cyan-300/70">CPU</span>
                <span className="text-[8px] font-mono text-txt-secondary tabular-nums">{hardwareMetrics.cpu.percent}%</span>
              </div>
              <div className="h-[4px] rounded-full bg-white/[0.06] overflow-hidden">
                <div className="h-full rounded-full bg-gradient-to-r from-cyan-500 to-cyan-400 gauge-bar" style={{ width: `${hardwareMetrics.cpu.percent}%` }} />
              </div>
            </div>
            <div>
              <div className="flex items-center justify-between mb-0.5">
                <span className="text-[8px] font-mono text-indigo-300/70">MEM</span>
                <span className="text-[8px] font-mono text-txt-secondary tabular-nums">{hardwareMetrics.memory.usedGB}/{hardwareMetrics.memory.totalGB} GB</span>
              </div>
              <div className="h-[4px] rounded-full bg-white/[0.06] overflow-hidden">
                <div className="h-full rounded-full bg-gradient-to-r from-indigo-500 to-indigo-400 gauge-bar" style={{ width: `${hardwareMetrics.memory.percent}%` }} />
              </div>
            </div>
            {hardwareMetrics.gpu?.available && (
              <div>
                <div className="flex items-center justify-between mb-0.5">
                  <span className="text-[8px] font-mono text-emerald-300/70">GPU</span>
                  <span className="text-[8px] font-mono text-txt-secondary tabular-nums">{hardwareMetrics.gpu.utilPercent}%</span>
                </div>
                <div className="h-[4px] rounded-full bg-white/[0.06] overflow-hidden">
                  <div className="h-full rounded-full bg-gradient-to-r from-emerald-500 to-emerald-400 gauge-bar" style={{ width: `${hardwareMetrics.gpu.utilPercent}%` }} />
                </div>
              </div>
            )}
            <div className="text-[7px] font-mono text-txt-tertiary/50">{hardwareMetrics.processes.length} processes</div>
          </div>
        </div>
      )}
```

- [ ] **Step 3: Wire hardwareMetrics state in Dashboard**

In the root `Dashboard` component (around line 1920), add the type and state.

Before the `Dashboard` function, add the interface:

```tsx
interface HwMetrics {
  cpu: { percent: number };
  memory: { usedGB: number; totalGB: number; percent: number };
  gpu: { available: boolean; name?: string; utilPercent?: number; vramUsedMB?: number; vramTotalMB?: number; tempC?: number } | null;
  processes: { pid: number; name: string; cpuPercent: number; memoryMB: number; parentPid: number }[];
}
```

After the existing state declarations inside `Dashboard`, add:

```tsx
  const [hardwareMetrics, setHardwareMetrics] = useState<HwMetrics | null>(null);
  const [hardwareHistory, setHardwareHistory] = useState<HwMetrics[]>([]);
```

In the socket `useEffect` (the one starting around line 1991 that creates the socket.io connection), add at the end of the setup block (before the `return` cleanup):

```tsx
    const hwApi = (window as unknown as Record<string, Record<string, (...args: unknown[]) => void>>).electronAPI;
    hwApi?.onHardwareMetrics?.((data: unknown) => {
      const d = data as HwMetrics;
      setHardwareMetrics(d);
      setHardwareHistory(prev => {
        const next = [...prev, d];
        return next.length > 120 ? next.slice(-120) : next;
      });
    });
```

And in the cleanup `return` of that same `useEffect`, add:

```tsx
      hwApi?.removeHardwareMetrics?.();
```

- [ ] **Step 4: Pass hardwareMetrics to Sidebar**

At line 2102, update the Sidebar usage:

Change:
```tsx
          <Sidebar metrics={metrics} model={model} session={session} onReset={() => socketRef.current?.emit("reset_stats")} fileTargets={fileTargets} onCycleTarget={cycleFileTarget} snipedCount={snipedFiles.length} />
```

To:
```tsx
          <Sidebar metrics={metrics} model={model} session={session} onReset={() => socketRef.current?.emit("reset_stats")} fileTargets={fileTargets} onCycleTarget={cycleFileTarget} snipedCount={snipedFiles.length} hardwareMetrics={hardwareMetrics} />
```

Also update the Sidebar function signature (from Step 1) to use the `HwMetrics` interface:

```tsx
function Sidebar({ ..., hardwareMetrics }: { ...; hardwareMetrics?: HwMetrics | null }) {
```

- [ ] **Step 5: Verify build**

Run: `npx next build`
Expected: Build succeeds

- [ ] **Step 6: Commit**

```bash
git add app/components/Dashboard.tsx
git commit -m "feat: add hardware gauges to sidebar bottom zone"
```

---

### Task 5: Enable MONITOR Tab & Create MonitorView

**Files:**
- Modify: `app/components/Dashboard.tsx:1878` (StatusBar tab config)
- Modify: `app/components/Dashboard.tsx:2096` (add monitor view rendering)
- Modify: `app/components/Dashboard.tsx` (add MonitorView component before StatusBar)

- [ ] **Step 1: Enable MONITOR tab**

At line 1878, change:

```tsx
            { id: "archive", label: "ARCHIVE", enabled: false },
```

To:

```tsx
            { id: "monitor", label: "MONITOR", enabled: true },
```

- [ ] **Step 2: Add MonitorView component**

Insert the following component before the `StatusBar` function:

```tsx
function MiniSparkline({ data, color, width = 80, height = 20 }: { data: number[]; color: string; width?: number; height?: number }) {
  if (data.length < 2) return null;
  const max = 100;
  const points = data.map((v, i) => `${(i / (data.length - 1)) * width},${height - (v / max) * height}`).join(" ");
  return (
    <svg width={width} height={height} className="opacity-60">
      <polyline points={points} fill="none" stroke={color} strokeWidth="1.5" strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  );
}

function ProcessTree({ processes }: { processes: { pid: number; name: string; cpuPercent: number; memoryMB: number; parentPid: number }[] }) {
  const [collapsed, setCollapsed] = useState<Set<number>>(new Set());
  if (processes.length === 0) return <p className="text-[9px] font-mono text-txt-tertiary">No processes tracked</p>;

  const rootPids = new Set(processes.map(p => p.pid));
  const roots = processes.filter(p => !rootPids.has(p.parentPid));
  const childMap = new Map<number, typeof processes>();
  for (const p of processes) {
    if (!childMap.has(p.parentPid)) childMap.set(p.parentPid, []);
    childMap.get(p.parentPid)!.push(p);
  }

  function renderNode(proc: typeof processes[0], depth: number): React.ReactNode {
    const children = childMap.get(proc.pid) || [];
    const hasChildren = children.length > 0;
    const isCollapsed = collapsed.has(proc.pid);
    return (
      <div key={proc.pid}>
        <div className="flex items-center gap-2 py-0.5 hover:bg-white/[0.03] rounded px-1" style={{ paddingLeft: depth * 16 }}>
          {hasChildren ? (
            <button onClick={() => setCollapsed(prev => { const s = new Set(prev); if (s.has(proc.pid)) s.delete(proc.pid); else s.add(proc.pid); return s; })} className="text-txt-tertiary w-3 text-[10px]">
              {isCollapsed ? "\u25B6" : "\u25BC"}
            </button>
          ) : <span className="w-3" />}
          <span className="text-[8px] font-mono text-txt-tertiary tabular-nums w-12">{proc.pid}</span>
          <span className="text-[9px] font-mono text-txt-secondary flex-1 truncate">{proc.name}</span>
          <span className="text-[8px] font-mono text-cyan-300/60 tabular-nums w-10 text-right">{proc.cpuPercent}%</span>
          <span className="text-[8px] font-mono text-indigo-300/60 tabular-nums w-14 text-right">{proc.memoryMB} MB</span>
        </div>
        {hasChildren && !isCollapsed && children.map(c => renderNode(c, depth + 1))}
      </div>
    );
  }

  return <div>{(roots.length > 0 ? roots : processes.slice(0, 1)).map(r => renderNode(r, 0))}</div>;
}

function HistoryChart({ history, width = 500, height = 100 }: { history: { cpu: { percent: number }; memory: { percent: number } }[]; width?: number; height?: number }) {
  if (history.length < 2) return null;
  const cpuPoints = history.map((h, i) => `${(i / (history.length - 1)) * width},${height - (h.cpu.percent / 100) * height}`).join(" ");
  const memPoints = history.map((h, i) => `${(i / (history.length - 1)) * width},${height - (h.memory.percent / 100) * height}`).join(" ");
  return (
    <svg width="100%" viewBox={`0 0 ${width} ${height + 20}`} preserveAspectRatio="none" className="w-full">
      <line x1="0" y1={height} x2={width} y2={height} stroke="rgba(255,255,255,0.06)" strokeWidth="0.5" />
      <line x1="0" y1={height * 0.5} x2={width} y2={height * 0.5} stroke="rgba(255,255,255,0.03)" strokeWidth="0.5" strokeDasharray="4 4" />
      <polyline points={memPoints} fill="none" stroke="rgba(129,140,248,0.5)" strokeWidth="1.5" strokeLinejoin="round" />
      <polyline points={cpuPoints} fill="none" stroke="rgba(34,211,238,0.7)" strokeWidth="1.5" strokeLinejoin="round" />
      <text x="4" y={height + 14} fill="rgba(255,255,255,0.2)" fontSize="8" fontFamily="monospace">5m ago</text>
      <text x={width - 20} y={height + 14} fill="rgba(255,255,255,0.2)" fontSize="8" fontFamily="monospace">now</text>
    </svg>
  );
}

function MonitorView({ current, history }: { current: HwMetrics | null; history: HwMetrics[] }) {
  if (!current) return (
    <div className="flex items-center justify-center h-full">
      <p className="text-[11px] font-sans text-txt-tertiary">Waiting for hardware data...</p>
    </div>
  );

  const { cpu, memory, gpu, processes } = current;

  const cpuHistory = history.map(h => h.cpu.percent);
  const memHistory = history.map(h => h.memory.percent);
  const cpuSparkline = cpuHistory.slice(-60);
  const memSparkline = memHistory.slice(-60);
  const cpuPeak = cpuHistory.length > 0 ? Math.max(...cpuHistory) : 0;
  const memPeak = memHistory.length > 0 ? Math.max(...memHistory) : 0;

  return (
    <div className="p-4 space-y-4 overflow-y-auto h-full">
      <div>
        <span className="text-[8px] font-sans font-bold tracking-[0.2em] uppercase text-txt-tertiary">System Overview</span>
        <div className={`grid gap-3 mt-2 ${gpu?.available ? "grid-cols-3" : "grid-cols-2"}`}>
          <div className="rounded-xl border border-white/[0.08] p-3" style={{ background: "rgba(255,255,255,0.02)" }}>
            <div className="flex items-center justify-between mb-2">
              <span className="text-[9px] font-sans font-bold text-cyan-300">CPU</span>
              <span className="text-[7px] font-mono text-txt-tertiary">peak {cpuPeak}%</span>
            </div>
            <span className="text-[20px] font-mono font-bold text-cyan-300 tabular-nums">{cpu.percent}%</span>
            <div className="mt-2">
              <MiniSparkline data={cpuSparkline} color="rgb(34,211,238)" />
            </div>
          </div>
          <div className="rounded-xl border border-white/[0.08] p-3" style={{ background: "rgba(255,255,255,0.02)" }}>
            <div className="flex items-center justify-between mb-2">
              <span className="text-[9px] font-sans font-bold text-indigo-300">Memory</span>
              <span className="text-[7px] font-mono text-txt-tertiary">peak {memPeak}%</span>
            </div>
            <span className="text-[20px] font-mono font-bold text-indigo-300 tabular-nums">{memory.percent}%</span>
            <div className="text-[8px] font-mono text-txt-tertiary mt-0.5">{memory.usedGB} / {memory.totalGB} GB</div>
            <div className="mt-2">
              <MiniSparkline data={memSparkline} color="rgb(129,140,248)" />
            </div>
          </div>
          {gpu?.available && (
            <div className="rounded-xl border border-white/[0.08] p-3" style={{ background: "rgba(255,255,255,0.02)" }}>
              <div className="flex items-center justify-between mb-2">
                <span className="text-[9px] font-sans font-bold text-emerald-300">GPU</span>
                <span className="text-[7px] font-mono text-txt-tertiary">{gpu.tempC}&deg;C</span>
              </div>
              <span className="text-[20px] font-mono font-bold text-emerald-300 tabular-nums">{gpu.utilPercent}%</span>
              <div className="text-[8px] font-mono text-txt-tertiary mt-0.5">{gpu.name}</div>
              <div className="mt-2">
                <div className="flex items-center justify-between mb-0.5">
                  <span className="text-[7px] font-mono text-txt-tertiary">VRAM</span>
                  <span className="text-[7px] font-mono text-txt-tertiary">{gpu.vramUsedMB}/{gpu.vramTotalMB} MB</span>
                </div>
                <div className="h-[4px] rounded-full bg-white/[0.06] overflow-hidden">
                  <div className="h-full rounded-full bg-gradient-to-r from-emerald-500 to-emerald-400" style={{ width: `${gpu.vramTotalMB ? (gpu.vramUsedMB! / gpu.vramTotalMB) * 100 : 0}%` }} />
                </div>
              </div>
            </div>
          )}
        </div>
      </div>

      <div>
        <span className="text-[8px] font-sans font-bold tracking-[0.2em] uppercase text-txt-tertiary">Process Tree</span>
        <div className="mt-2 rounded-xl border border-white/[0.08] p-3" style={{ background: "rgba(255,255,255,0.02)" }}>
          <div className="flex items-center gap-2 pb-1.5 mb-1.5 border-b border-white/[0.06] text-[7px] font-sans font-bold tracking-wider uppercase text-txt-tertiary">
            <span className="w-3" />
            <span className="w-12">PID</span>
            <span className="flex-1">Name</span>
            <span className="w-10 text-right">CPU</span>
            <span className="w-14 text-right">Memory</span>
          </div>
          <ProcessTree processes={processes} />
        </div>
      </div>

      <div>
        <div className="flex items-center justify-between">
          <span className="text-[8px] font-sans font-bold tracking-[0.2em] uppercase text-txt-tertiary">History</span>
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-1"><div className="w-2 h-0.5 rounded bg-cyan-400/70" /><span className="text-[7px] font-mono text-txt-tertiary">CPU</span></div>
            <div className="flex items-center gap-1"><div className="w-2 h-0.5 rounded bg-indigo-400/50" /><span className="text-[7px] font-mono text-txt-tertiary">MEM</span></div>
          </div>
        </div>
        <div className="mt-2 rounded-xl border border-white/[0.08] p-3" style={{ background: "rgba(255,255,255,0.02)" }}>
          <HistoryChart history={typedHistory} />
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Add MonitorView rendering**

**IMPORTANT:** This must go INSIDE the `<AnimatePresence>` block, after the MAP view's closing `</motion.div>` (line 2095) and BEFORE the `</AnimatePresence>` closing tag (line 2097). Add:

```tsx
            {activeView === "monitor" && (
              <motion.div key="monitor-view" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.25 }} className="flex-1 min-h-0">
                <MonitorView current={hardwareMetrics as HwMetrics | null} history={hardwareHistory as HwMetrics[]} />
              </motion.div>
            )}
```

- [ ] **Step 4: Verify build**

Run: `npx next build`
Expected: Build succeeds

- [ ] **Step 5: Commit**

```bash
git add app/components/Dashboard.tsx
git commit -m "feat: add MONITOR tab with system gauges, process tree, and history chart"
```

---

### Task 6: Manual Integration Test

- [ ] **Step 1: Start the app**

Run: `npm run start`
Expected: ModelScope launches, sidebar shows hardware gauges pinned at bottom (CPU %, MEM %, optionally GPU %)

- [ ] **Step 2: Verify sidebar gauges update**

Watch the sidebar for ~10 seconds.
Expected: CPU and memory bars update every 2.5 seconds with current system values

- [ ] **Step 3: Open MONITOR tab**

Click the "MONITOR" tab in the top navigation bar.
Expected: Full hardware view appears with three gauge cards (CPU, Memory, GPU if available), a process tree, and a history chart

- [ ] **Step 4: Verify sparklines populate**

Wait 30 seconds on the MONITOR tab.
Expected: Sparklines on gauge cards show growing line data, history chart shows two lines (cyan CPU, indigo memory)

- [ ] **Step 5: Verify process tree**

Check the process tree section.
Expected: Shows at least the Electron process and its children. If a Claude session is active, shows the pty process tree.

- [ ] **Step 6: Switch back to FEED and verify sidebar persists**

Click "FEED" tab, check the sidebar bottom.
Expected: Hardware gauges still visible and updating at the bottom of the sidebar

- [ ] **Step 7: Commit final state**

```bash
git add -A
git commit -m "feat: hardware metrics — complete"
```
