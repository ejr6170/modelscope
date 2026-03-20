import { app, BrowserWindow, screen, ipcMain, globalShortcut } from "electron";
import { createRequire } from "module";
import path from "path";
import { fileURLToPath } from "url";
import { fork } from "child_process";
import HardwareMonitor from "../src/hardware-monitor.js";

const require = createRequire(import.meta.url);
const { autoUpdater } = require("electron-updater");
const pty = require("node-pty");

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

  let ptyProcess = null;

  const PERMISSION_RE = /\b(permission|approve|allow|deny|y\/n|\[Y\/n\]|\[y\/N\]|Do you want|Would you like|hasn't been granted|haven't granted)\b/i;
  const ANSI_RE = /\x1B(?:\[[0-9;]*[A-Za-z]|\].*?(?:\x07|\x1B\\)|\([A-Z])/g;

  function cleanOutput(raw) {
    return raw.replace(ANSI_RE, "").replace(/\r/g, "");
  }

  ipcMain.on("send-prompt", (_e, text) => {
    if (!mainWindow) return;
    if (ptyProcess) {
      ptyProcess.kill();
      ptyProcess = null;
    }

    mainWindow.webContents.send("prompt-response", { type: "start" });
    mainWindow.webContents.send("status-change", "thinking");

    const shell = process.platform === "win32" ? "cmd.exe" : "/bin/bash";
    const shellArgs = process.platform === "win32"
      ? ["/c", `claude -p --output-format text --verbose`]
      : ["-c", `claude -p --output-format text --verbose`];

    ptyProcess = pty.spawn(shell, shellArgs, {
      name: "xterm-256color",
      cols: 120,
      rows: 30,
      cwd: process.cwd(),
      env: { ...process.env, FORCE_COLOR: "0", NO_COLOR: "1" },
      encoding: "utf8",
    });

    ptyProcess.write(text + "\r");

    if (hardwareMonitor) hardwareMonitor.setRootPid(ptyProcess.pid);

    let firstChunk = true;

    ptyProcess.onData((raw) => {
      const clean = cleanOutput(raw);
      mainWindow?.webContents.send("prompt-response", { type: "raw", data: raw });
      if (clean.trim()) {
        if (firstChunk) { mainWindow?.webContents.send("status-change", "streaming"); firstChunk = false; }
        mainWindow?.webContents.send("prompt-response", { type: "chunk", data: clean });
      }
      if (PERMISSION_RE.test(clean)) {
        mainWindow?.webContents.send("status-change", "permission");
      }
    });

    ptyProcess.onExit(() => {
      mainWindow?.webContents.send("prompt-response", { type: "done" });
      mainWindow?.webContents.send("status-change", "idle");
      ptyProcess = null;
      if (hardwareMonitor) hardwareMonitor.setRootPid(null);
    });
  });

  ipcMain.on("send-to-terminal", (_e, input) => {
    if (!ptyProcess) return;
    ptyProcess.write(input + "\r");
  });

  ipcMain.on("cancel-command", () => {
    if (ptyProcess) {
      ptyProcess.kill();
      ptyProcess = null;
      if (hardwareMonitor) hardwareMonitor.setRootPid(null);
      mainWindow?.webContents.send("prompt-response", { type: "done" });
      mainWindow?.webContents.send("status-change", "idle");
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
