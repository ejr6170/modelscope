import { app, BrowserWindow, screen, ipcMain } from "electron";
import { createRequire } from "module";
import path from "path";
import { fileURLToPath } from "url";
import { fork } from "child_process";

const require = createRequire(import.meta.url);
const { autoUpdater } = require("electron-updater");

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const isDev = process.argv.includes("--dev") || !app.isPackaged;

let mainWindow = null;
let serverProcess = null;

function startBackendServer() {
  const serverPath = isDev
    ? path.join(__dirname, "..", "server.js")
    : path.join(process.resourcesPath, "server.js");

  serverProcess = fork(serverPath, [], {
    stdio: "pipe",
    env: { ...process.env, ELECTRON_RUN_AS_NODE: "1" },
  });

  serverProcess.on("error", (err) => {
    console.error(err);
  });
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
    frame: false,
    transparent: true,
    alwaysOnTop: true,
    skipTaskbar: false,
    resizable: true,
    minimizable: true,
    hasShadow: false,
    icon: path.join(__dirname, "..", "public", "logo.png"),
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, "preload.js"),
    },
  });

  ipcMain.on("window-minimize", () => mainWindow.minimize());
  ipcMain.on("window-toggle-maximize", () => {
    if (mainWindow.isMaximized()) mainWindow.unmaximize();
    else mainWindow.maximize();
  });
  ipcMain.on("window-close", () => mainWindow.close());
  ipcMain.on("window-always-on-top", (_e, value) => mainWindow.setAlwaysOnTop(value));
  ipcMain.on("install-update", () => autoUpdater.quitAndInstall());

  if (isDev) {
    mainWindow.loadURL("http://localhost:3777");
    mainWindow.webContents.on("did-fail-load", (_e, code, desc) => {
      console.error(`Failed to load: ${code} ${desc}`);
      setTimeout(() => mainWindow.loadURL("http://localhost:3777"), 2000);
    });
  } else {
    const appPath = app.getAppPath();
    const indexPath = path.join(appPath, "out", "index.html");
    mainWindow.loadFile(indexPath);
  }

  if (isDev) {
    mainWindow.webContents.openDevTools({ mode: "detach" });
  }

  setupAutoUpdater();
}

app.commandLine.appendSwitch("enable-transparent-visuals");

app.whenReady().then(() => {
  startBackendServer();
  setTimeout(createWindow, 200);
});

app.on("window-all-closed", () => {
  if (serverProcess) {
    serverProcess.kill();
    serverProcess = null;
  }
  app.quit();
});
