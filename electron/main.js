import { app, BrowserWindow, screen, ipcMain, globalShortcut } from "electron";
import { createRequire } from "module";
import path from "path";
import { fileURLToPath } from "url";
import { fork, spawn } from "child_process";
import HardwareMonitor from "../src/hardware-monitor.js";

const require = createRequire(import.meta.url);
const { autoUpdater } = require("electron-updater");


const __dirname = path.dirname(fileURLToPath(import.meta.url));
const isDev = process.argv.includes("--dev") || !app.isPackaged;

let mainWindow = null;
let serverProcess = null;
let hardwareMonitor = null;

function startBackendServer() {
  const serverPath = isDev
    ? path.join(__dirname, "..", "server.js")
    : path.join(process.resourcesPath, "server.js");

  serverProcess = fork(serverPath, [], {
    stdio: "pipe",
    env: { ...process.env, ELECTRON_RUN_AS_NODE: "1" },
  });

  serverProcess.on("error", () => {});
}

function setupAutoUpdater() {
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;

  autoUpdater.on("update-available", () => {
    mainWindow?.webContents.send("update-status", "downloading");
  });

  autoUpdater.on("update-downloaded", () => {
    mainWindow?.webContents.send("update-status", "ready");
  });

  autoUpdater.on("error", () => {
    mainWindow?.webContents.send("update-status", "idle");
  });

  autoUpdater.checkForUpdatesAndNotify();
}

function createWindow() {
  const { width: screenW, height: screenH } = screen.getPrimaryDisplay().workAreaSize;

  const winW = 820;
  const winH = 780;

  mainWindow = new BrowserWindow({
    width: winW,
    height: winH,
    x: screenW - winW - 24,
    y: screenH - winH - 24,
    show: false,
    frame: false,
    transparent: true,
    alwaysOnTop: false,
    skipTaskbar: false,
    resizable: true,
    minimizable: true,
    focusable: true,
    hasShadow: false,
    icon: path.join(__dirname, "..", "public", "logo.png"),
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, "preload.cjs"),
    },
  });

  mainWindow.once("ready-to-show", () => {
    mainWindow.show();
    mainWindow.focus();
  });

  hardwareMonitor = new HardwareMonitor();
  hardwareMonitor.onData((data) => {
    mainWindow?.webContents.send("hardware-metrics", data);
  });
  hardwareMonitor.start(2500);

  globalShortcut.register("CommandOrControl+K", () => {
    if (!mainWindow) return;
    mainWindow.setAlwaysOnTop(true);
    mainWindow.show();
    mainWindow.focus();
    mainWindow.setAlwaysOnTop(false);
    mainWindow.webContents.send("focus-input");
  });

  ipcMain.on("window-focus", () => {
    if (!mainWindow) return;
    mainWindow.setAlwaysOnTop(true);
    mainWindow.show();
    mainWindow.focus();
    mainWindow.setAlwaysOnTop(false);
  });
  ipcMain.on("window-minimize", () => mainWindow.minimize());
  ipcMain.on("window-toggle-maximize", () => {
    if (mainWindow.isMaximized()) mainWindow.unmaximize();
    else mainWindow.maximize();
  });
  ipcMain.on("window-close", () => mainWindow.close());
  ipcMain.on("window-always-on-top", (_e, value) => mainWindow.setAlwaysOnTop(value));
  ipcMain.on("install-update", () => autoUpdater.quitAndInstall());

  let activeProc = null;
  let isFirstPrompt = true;
  let cancelled = false;

  function parseStreamLine(line) {
    try {
      const msg = JSON.parse(line);
      if (!msg || !msg.type) return null;

      if (msg.type === "system" && msg.subtype === "init") {
        return { type: "init", sessionId: msg.session_id, model: msg.model, tools: msg.tools, cwd: msg.cwd };
      }

      if (msg.type === "assistant" && msg.message) {
        const u = msg.message.usage || {};
        return {
          type: "assistant",
          content: msg.message.content || [],
          tokens: {
            input: u.input_tokens || 0,
            output: u.output_tokens || 0,
            cacheRead: u.cache_read_input_tokens || 0,
            cacheCreation: u.cache_creation_input_tokens || 0,
          },
          model: msg.message.model || "",
        };
      }

      if (msg.type === "result") {
        return {
          type: "result",
          totalCost: msg.total_cost_usd || 0,
          durationMs: msg.duration_ms || 0,
          isError: msg.is_error || false,
          result: msg.result || "",
          usage: msg.usage || {},
        };
      }

      if (msg.type === "rate_limit_event" && msg.rate_limit_info) {
        return {
          type: "rateLimit",
          status: msg.rate_limit_info.status,
          resetsAt: msg.rate_limit_info.resetsAt,
        };
      }

      return null;
    } catch {
      return null;
    }
  }

  ipcMain.on("send-stream-prompt", (_e, text) => {
    if (!mainWindow) return;
    if (activeProc) {
      activeProc.kill();
      activeProc = null;
    }
    cancelled = false;

    const args = ["-p", "--output-format", "stream-json", "--verbose"];
    if (!isFirstPrompt) args.push("-c");

    const proc = spawn("claude", args, {
      shell: true,
      env: { ...process.env },
      stdio: ["pipe", "pipe", "pipe"],
      cwd: process.cwd(),
    });

    activeProc = proc;
    if (hardwareMonitor) hardwareMonitor.setRootPid(proc.pid);

    proc.stdin.write(text);
    proc.stdin.end();

    let buffer = "";

    proc.stdout.on("data", (chunk) => {
      buffer += chunk.toString();
      const lines = buffer.split("\n");
      buffer = lines.pop() || "";
      for (const line of lines) {
        if (!line.trim()) continue;
        const parsed = parseStreamLine(line);
        if (parsed) {
          mainWindow?.webContents.send("stream-event", parsed);
        }
      }
    });

    proc.stderr.on("data", () => {});

    proc.on("close", (code) => {
      if (cancelled) return;
      if (buffer.trim()) {
        const parsed = parseStreamLine(buffer);
        if (parsed) mainWindow?.webContents.send("stream-event", parsed);
      }
      if (hardwareMonitor) hardwareMonitor.setRootPid(null);
      mainWindow?.webContents.send("stream-event", { type: "done", exitCode: code });
      activeProc = null;
      if (code === 0) isFirstPrompt = false;
    });
  });

  ipcMain.on("cancel-stream", () => {
    if (activeProc) {
      cancelled = true;
      activeProc.kill();
      activeProc = null;
      if (hardwareMonitor) hardwareMonitor.setRootPid(null);
      mainWindow?.webContents.send("stream-event", { type: "done", exitCode: -1 });
    }
  });

  ipcMain.on("end-stream-session", () => {
    isFirstPrompt = true;
    if (activeProc) {
      activeProc.kill();
      activeProc = null;
      if (hardwareMonitor) hardwareMonitor.setRootPid(null);
    }
  });

  if (isDev) {
    mainWindow.loadURL("http://localhost:3777");
    mainWindow.webContents.on("did-fail-load", (_e, code, desc) => {
      setTimeout(() => mainWindow.loadURL("http://localhost:3777"), 2000);
    });
  } else {
    const appPath = app.getAppPath();
    const indexPath = path.join(appPath, "out", "index.html");
    mainWindow.loadFile(indexPath);
  }

  setupAutoUpdater();
}

app.commandLine.appendSwitch("enable-transparent-visuals");

app.whenReady().then(() => {
  startBackendServer();
  setTimeout(createWindow, 200);
});

app.on("will-quit", () => {
  globalShortcut.unregisterAll();
});

app.on("window-all-closed", () => {
  if (serverProcess) {
    serverProcess.kill();
    serverProcess = null;
  }
  if (hardwareMonitor) {
    hardwareMonitor.stop();
    hardwareMonitor = null;
  }
  app.quit();
});
