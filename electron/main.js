import { app, BrowserWindow, screen, ipcMain } from "electron";
import { autoUpdater } from "electron-updater";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

let mainWindow = null;

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

  mainWindow.loadURL("http://localhost:3777");

  mainWindow.webContents.on("did-fail-load", (_e, code, desc) => {
    console.error(`Failed to load: ${code} ${desc}`);
    setTimeout(() => mainWindow.loadURL("http://localhost:3777"), 2000);
  });

  if (process.argv.includes("--dev")) {
    mainWindow.webContents.openDevTools({ mode: "detach" });
  }

  setupAutoUpdater();
}

app.commandLine.appendSwitch("enable-transparent-visuals");

app.whenReady().then(() => {
  setTimeout(createWindow, 200);
});

app.on("window-all-closed", () => {
  app.quit();
});
