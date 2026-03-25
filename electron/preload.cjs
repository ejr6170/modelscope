const { contextBridge, ipcRenderer } = require("electron");

let lastFocus = 0;
window.addEventListener("mousedown", () => {
  const now = Date.now();
  if (now - lastFocus > 200) { lastFocus = now; ipcRenderer.send("window-focus"); }
});

contextBridge.exposeInMainWorld("electronAPI", {
  focus: () => ipcRenderer.send("window-focus"),
  minimize: () => ipcRenderer.send("window-minimize"),
  toggleMaximize: () => ipcRenderer.send("window-toggle-maximize"),
  close: () => ipcRenderer.send("window-close"),
  setAlwaysOnTop: (value) => ipcRenderer.send("window-always-on-top", value),
  installUpdate: () => ipcRenderer.send("install-update"),
  onUpdateStatus: (callback) => ipcRenderer.on("update-status", (_e, status) => callback(status)),
  sendStreamPrompt: (text) => ipcRenderer.send("send-stream-prompt", text),
  cancelStream: () => ipcRenderer.send("cancel-stream"),
  endStreamSession: () => ipcRenderer.send("end-stream-session"),
  onStreamEvent: (callback) => ipcRenderer.on("stream-event", (_e, data) => callback(data)),
  removeStreamEvent: () => ipcRenderer.removeAllListeners("stream-event"),
  onFocusInput: (callback) => ipcRenderer.on("focus-input", callback),
  removeFocusInput: () => ipcRenderer.removeAllListeners("focus-input"),
  onHardwareMetrics: (callback) => ipcRenderer.on("hardware-metrics", (_e, data) => callback(data)),
  removeHardwareMetrics: () => ipcRenderer.removeAllListeners("hardware-metrics"),
  onSessionStatus: (callback) => ipcRenderer.on("session-status", (_e, data) => callback(data)),
  removeSessionStatus: () => ipcRenderer.removeAllListeners("session-status"),
});
