import { app, BrowserWindow, screen, ipcMain } from "electron";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function createWindow() {
  const { width: screenW, height: screenH } = screen.getPrimaryDisplay().workAreaSize;

  const winW = 820;
  const winH = 780;

  const win = new BrowserWindow({
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

  ipcMain.on("window-minimize", () => win.minimize());
  ipcMain.on("window-toggle-maximize", () => {
    if (win.isMaximized()) win.unmaximize();
    else win.maximize();
  });
  ipcMain.on("window-close", () => win.close());
  ipcMain.on("window-always-on-top", (_e, value) => win.setAlwaysOnTop(value));

  win.loadURL("http://localhost:3777");

  win.webContents.on("did-fail-load", (_e, code, desc) => {
    console.error(`Failed to load: ${code} ${desc}`);
    setTimeout(() => win.loadURL("http://localhost:3777"), 2000);
  });

  if (process.argv.includes("--dev")) {
    win.webContents.openDevTools({ mode: "detach" });
  }
}

app.commandLine.appendSwitch("enable-transparent-visuals");

app.whenReady().then(() => {
  setTimeout(createWindow, 200);
});

app.on("window-all-closed", () => {
  app.quit();
});
