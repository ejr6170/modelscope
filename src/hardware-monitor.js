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
