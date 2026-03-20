const { contextBridge, ipcRenderer } = require("electron");

window.addEventListener("mousedown", () => {
  ipcRenderer.send("window-focus");
});

contextBridge.exposeInMainWorld("electronAPI", {
  focus: () => ipcRenderer.send("window-focus"),
  minimize: () => ipcRenderer.send("window-minimize"),
  toggleMaximize: () => ipcRenderer.send("window-toggle-maximize"),
  close: () => ipcRenderer.send("window-close"),
  setAlwaysOnTop: (value) => ipcRenderer.send("window-always-on-top", value),
  installUpdate: () => ipcRenderer.send("install-update"),
  onUpdateStatus: (callback) => ipcRenderer.on("update-status", (_e, status) => callback(status)),
  sendPrompt: (text) => ipcRenderer.send("send-prompt", text),
  sendToTerminal: (text) => ipcRenderer.send("send-to-terminal", text),
  cancelCommand: () => ipcRenderer.send("cancel-command"),
  onPromptResponse: (callback) => ipcRenderer.on("prompt-response", (_e, data) => callback(data)),
  removePromptResponse: () => ipcRenderer.removeAllListeners("prompt-response"),
  onFocusInput: (callback) => ipcRenderer.on("focus-input", callback),
  removeFocusInput: () => ipcRenderer.removeAllListeners("focus-input"),
  onStatusChange: (callback) => ipcRenderer.on("status-change", (_e, status) => callback(status)),
  removeStatusChange: () => ipcRenderer.removeAllListeners("status-change"),
  onHardwareMetrics: (callback) => ipcRenderer.on("hardware-metrics", (_e, data) => callback(data)),
  removeHardwareMetrics: () => ipcRenderer.removeAllListeners("hardware-metrics"),
});
