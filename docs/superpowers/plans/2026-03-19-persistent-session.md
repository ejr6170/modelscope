# Persistent Interactive Session Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the one-shot command bar with a persistent interactive Claude session that stays alive across multiple prompts.

**Architecture:** The Electron main process manages a node-pty session lifecycle (start/write/interrupt/end). The preload bridge exposes session control methods. The React CommandBar component displays an append-only transcript and a status pill reflecting the session state.

**Tech Stack:** Electron, node-pty, React, Tailwind CSS, IPC via contextBridge

---

## File Structure

| File | Action | Responsibility |
|------|--------|---------------|
| `electron/main.js` | Modify | Session lifecycle (start/end/interrupt), pty management, state detection, IPC events |
| `electron/preload.cjs` | Modify | Bridge: session control methods + event listeners |
| `app/components/Dashboard.tsx` | Modify | CommandBar rewrite: transcript, status pill, session controls |
| `app/globals.css` | Modify | Add session status pill animations |

**IMPORTANT:** Tasks 1, 2, and 4 modify the IPC contract between all three files. They must be applied together — do NOT test or commit individually. Task 3 (CSS) is independent and can be committed separately.

---

### Task 1: Rewrite main.js Session Handlers

**Files:**
- Modify: `electron/main.js:107-175` (replace `ptyProcess` declaration, `send-prompt`, `send-to-terminal`, `cancel-command` handlers. Keep the `install-update` handler at line 105.)

- [ ] **Step 1: Remove old one-shot handlers**

Delete lines 107–175: the `ptyProcess` variable, `PERMISSION_RE`, `ANSI_RE`, `cleanOutput`, `send-prompt` handler, `send-to-terminal` handler, and `cancel-command` handler. Keep everything before line 107 (including the `install-update` handler at line 105).

- [ ] **Step 2: Add session lifecycle handlers**

Insert the following after the `install-update` handler (after line 105):

```javascript
let ptyProcess = null;
let idleTimer = null;
let permissionCooldown = false;
let sessionEnding = false;
let currentStatus = "none";
let pendingPrompt = null;

const PERMISSION_RE = /\b(permission|approve|allow|deny|y\/n|\[Y\/n\]|\[y\/N\]|Do you want|Would you like|hasn't been granted|haven't granted)\b/i;
const ANSI_RE = /\x1B(?:\[[0-9;]*[A-Za-z]|\].*?(?:\x07|\x1B\\)|\([A-Z])/g;

function cleanOutput(raw) {
  return raw.replace(ANSI_RE, "").replace(/\r/g, "");
}

function sendStatus(status, message) {
  currentStatus = status;
  mainWindow?.webContents.send("session-status", { status, message });
}

function resetIdleTimer() {
  if (idleTimer) clearTimeout(idleTimer);
  idleTimer = setTimeout(() => {
    if (ptyProcess && currentStatus !== "waiting") sendStatus("active");
  }, 500);
}

ipcMain.on("start-session", () => {
  if (!mainWindow || ptyProcess) return;

  try {
    const shell = process.platform === "win32" ? "cmd.exe" : "/bin/bash";
    const shellArgs = process.platform === "win32" ? ["/k", "claude"] : ["-c", "claude"];

    sessionEnding = false;

    ptyProcess = pty.spawn(shell, shellArgs, {
      name: "xterm-256color",
      cols: 120,
      rows: 30,
      cwd: process.cwd(),
      env: { ...process.env, FORCE_COLOR: "0", NO_COLOR: "1" },
      encoding: "utf8",
    });

    sendStatus("active");

    ptyProcess.onData((raw) => {
      const clean = cleanOutput(raw);
      if (clean.trim()) {
        mainWindow?.webContents.send("session-output", { data: clean });
      }
      resetIdleTimer();
      if (!permissionCooldown && PERMISSION_RE.test(clean)) {
        sendStatus("waiting");
      }
      if (pendingPrompt && currentStatus === "active") {
        const text = pendingPrompt;
        pendingPrompt = null;
        ptyProcess?.write(text + "\r");
        sendStatus("working");
        resetIdleTimer();
      }
    });

    ptyProcess.onExit(() => {
      ptyProcess = null;
      if (idleTimer) { clearTimeout(idleTimer); idleTimer = null; }
      if (!sessionEnding) sendStatus("none");
      sessionEnding = false;
    });
  } catch (err) {
    sendStatus("error", err.message || "Failed to start session");
  }
});

ipcMain.on("send-to-terminal", (_e, text) => {
  if (!ptyProcess) return;
  ptyProcess.write(text + "\r");
  sendStatus("working");
  resetIdleTimer();
  permissionCooldown = true;
  setTimeout(() => { permissionCooldown = false; }, 1000);
});

ipcMain.on("queue-prompt", (_e, text) => {
  pendingPrompt = text;
});

ipcMain.on("interrupt-session", () => {
  if (!ptyProcess) return;
  ptyProcess.write("\x03");
});

ipcMain.on("end-session", () => {
  if (!ptyProcess) return;
  sessionEnding = true;
  ptyProcess.kill();
  ptyProcess = null;
  if (idleTimer) { clearTimeout(idleTimer); idleTimer = null; }
  sendStatus("none");
});
```

- [ ] **Step 3: Verify main.js is syntactically valid**

Run: `node --check electron/main.js`
Expected: no output (clean parse)

---

### Task 2: Update Preload Bridge

**Files:**
- Modify: `electron/preload.cjs` (full rewrite of exposed API)

- [ ] **Step 1: Rewrite preload.cjs**

Replace the entire file content with:

```javascript
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
  startSession: () => ipcRenderer.send("start-session"),
  endSession: () => ipcRenderer.send("end-session"),
  interruptSession: () => ipcRenderer.send("interrupt-session"),
  sendToTerminal: (text) => ipcRenderer.send("send-to-terminal", text),
  queuePrompt: (text) => ipcRenderer.send("queue-prompt", text),
  onSessionOutput: (callback) => ipcRenderer.on("session-output", (_e, data) => callback(data)),
  removeSessionOutput: () => ipcRenderer.removeAllListeners("session-output"),
  onSessionStatus: (callback) => ipcRenderer.on("session-status", (_e, data) => callback(data)),
  removeSessionStatus: () => ipcRenderer.removeAllListeners("session-status"),
  onFocusInput: (callback) => ipcRenderer.on("focus-input", callback),
  removeFocusInput: () => ipcRenderer.removeAllListeners("focus-input"),
});
```

---

### Task 3: Add Session Status CSS Animations

**Files:**
- Modify: `app/globals.css` (add new keyframes after `.cmd-permission` block, around line 104)

- [ ] **Step 1: Add status pill animations**

Add after the `.cmd-permission` closing brace:

```css
@keyframes status-active {
  0%, 100% { box-shadow: 0 0 0 0 rgba(74, 222, 128, 0.4); }
  50% { box-shadow: 0 0 0 3px rgba(74, 222, 128, 0.1); }
}
.status-active {
  animation: status-active 2s ease-in-out infinite;
}

@keyframes status-working {
  0%, 100% { opacity: 0.6; }
  50% { opacity: 1; }
}
.status-working {
  animation: status-working 1s ease-in-out infinite;
}
```

- [ ] **Step 2: Commit CSS independently**

```bash
git add app/globals.css
git commit -m "feat: add session status pill CSS animations"
```

---

### Task 4: Rewrite CommandBar Component

**Files:**
- Modify: `app/components/Dashboard.tsx:1625-1845` (replace entire `CommandBar` function)

- [ ] **Step 1: Replace the CommandBar function**

Delete lines 1625-1845 (the entire `function CommandBar()` through its closing `}`). Replace with:

```tsx
function CommandBar() {
  const [input, setInput] = useState("");
  const [transcript, setTranscript] = useState("");
  const [sessionActive, setSessionActive] = useState(false);
  const [sessionStatus, setSessionStatus] = useState<"none" | "active" | "waiting" | "working" | "error">("none");
  const [statusMessage, setStatusMessage] = useState("");
  const [transcriptHeight, setTranscriptHeight] = useState(150);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const transcriptRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<{ startY: number; startH: number } | null>(null);

  type SessionAPI = {
    startSession: () => void;
    endSession: () => void;
    interruptSession: () => void;
    sendToTerminal: (t: string) => void;
    queuePrompt: (t: string) => void;
    onSessionOutput: (cb: (d: { data: string }) => void) => void;
    removeSessionOutput: () => void;
    onSessionStatus: (cb: (d: { status: string; message?: string }) => void) => void;
    removeSessionStatus: () => void;
    onFocusInput: (cb: () => void) => void;
    removeFocusInput: () => void;
  };

  const getApi = () => (window as unknown as Record<string, SessionAPI>).electronAPI;

  useEffect(() => {
    const api = getApi();
    if (!api) return;

    api.onFocusInput(() => { inputRef.current?.focus(); });

    api.onSessionOutput((msg) => {
      setTranscript(prev => prev + msg.data);
    });

    api.onSessionStatus((msg) => {
      const s = msg.status as "none" | "active" | "waiting" | "working" | "error";
      setSessionStatus(s);
      setSessionActive(s !== "none" && s !== "error");
      if (msg.message) setStatusMessage(msg.message);
      if (s === "active") inputRef.current?.focus();
    });

    return () => {
      api.removeSessionOutput();
      api.removeSessionStatus();
      api.removeFocusInput();
    };
  }, []);

  useEffect(() => {
    if (transcriptRef.current) {
      transcriptRef.current.scrollTop = transcriptRef.current.scrollHeight;
    }
  }, [transcript]);

  const resizeTextarea = useCallback(() => {
    const el = inputRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = Math.min(el.scrollHeight, 300) + "px";
  }, []);

  useEffect(() => { resizeTextarea(); }, [input, resizeTextarea]);

  const send = () => {
    const text = input.trim();
    if (!text) return;
    const api = getApi();
    if (!api) return;

    if (!sessionActive && sessionStatus === "none") {
      api.startSession();
      api.queuePrompt(text);
    } else {
      api.sendToTerminal(text);
    }
    setInput("");
    if (inputRef.current) inputRef.current.style.height = "auto";
  };

  const endSession = () => {
    const api = getApi();
    if (!api) return;
    api.endSession();
    setTranscript("");
  };

  const interrupt = () => {
    const api = getApi();
    if (!api) return;
    api.interruptSession();
  };

  const clearTranscript = () => { setTranscript(""); };

  const onDragStart = (e: React.MouseEvent) => {
    e.preventDefault();
    dragRef.current = { startY: e.clientY, startH: transcriptHeight };
    const onMove = (ev: MouseEvent) => {
      if (!dragRef.current) return;
      const delta = dragRef.current.startY - ev.clientY;
      const maxH = window.innerHeight * 0.5;
      setTranscriptHeight(Math.max(80, Math.min(dragRef.current.startH + delta, maxH)));
    };
    const onUp = () => {
      dragRef.current = null;
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  };

  const isWaiting = sessionStatus === "waiting";
  const isWorking = sessionStatus === "working";
  const isError = sessionStatus === "error";
  const barClass = isWaiting ? "cmd-permission" : isWorking ? "cmd-thinking" : "";

  const statusConfig: Record<string, { color: string; label: string; dotClass: string }> = {
    none: { color: "bg-white/20", label: "No Session", dotClass: "" },
    active: { color: "bg-green-400", label: "Active", dotClass: "status-active" },
    waiting: { color: "bg-amber-400", label: "Waiting", dotClass: "animate-pulse" },
    working: { color: "bg-cyan-400", label: "Working", dotClass: "status-working" },
    error: { color: "bg-red-400", label: "Error", dotClass: "" },
  };

  const pill = statusConfig[sessionStatus] || statusConfig.none;

  return (
    <div className={`no-drag shrink-0 border-t border-white/[0.08] transition-all duration-300 ${barClass}`} style={{ background: "rgba(0, 0, 0, 0.40)", backdropFilter: "blur(24px) saturate(150%)" }}>
      {transcript && (
        <>
          <div className="cursor-row-resize h-1 hover:bg-indigo-400/20 transition-colors" onMouseDown={onDragStart} />
          <div ref={transcriptRef} className="px-3 pt-1 pb-1 overflow-y-auto" style={{ maxHeight: transcriptHeight }}>
            <pre className="text-[9px] font-mono text-indigo-200/70 leading-relaxed whitespace-pre-wrap break-words">{transcript}</pre>
          </div>
        </>
      )}
      {isWaiting && (
        <div className="flex items-center gap-2 px-3 py-1.5 border-t border-amber-400/10">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-amber-400/70 shrink-0">
            <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" /><line x1="12" y1="9" x2="12" y2="13" /><line x1="12" y1="17" x2="12.01" y2="17" />
          </svg>
          <span className="text-[8px] font-sans font-bold tracking-[0.12em] uppercase text-amber-300/70">Permission Required</span>
          <div className="flex-1" />
          <button onClick={() => { const api = getApi(); api?.sendToTerminal("y"); }}
            className="px-2.5 py-1 rounded-md text-[8px] font-sans font-bold tracking-wider uppercase transition-all"
            style={{ background: "rgba(74, 222, 128, 0.15)", border: "1px solid rgba(74, 222, 128, 0.20)", color: "rgba(134, 239, 172, 0.9)" }}>
            Approve
          </button>
          <button onClick={() => { const api = getApi(); api?.sendToTerminal("n"); }}
            className="px-2.5 py-1 rounded-md text-[8px] font-sans font-bold tracking-wider uppercase transition-all"
            style={{ background: "rgba(239, 68, 68, 0.15)", border: "1px solid rgba(239, 68, 68, 0.20)", color: "rgba(252, 165, 165, 0.9)" }}>
            Deny
          </button>
        </div>
      )}
      {isError && statusMessage && (
        <div className="px-3 py-1.5 border-t border-red-400/10">
          <p className="text-[8px] font-mono text-red-400/70">{statusMessage}</p>
        </div>
      )}
      <div className="flex items-end gap-2 px-3 py-2">
        <div className="flex items-center gap-1.5 shrink-0 self-center">
          <div className={`w-2 h-2 rounded-full ${pill.color} ${pill.dotClass}`} />
          <span className="text-[7px] font-mono text-txt-tertiary w-[52px]">{pill.label}</span>
        </div>
        <div className="relative flex-1">
          <textarea
            ref={inputRef}
            rows={1}
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={e => {
              if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); }
              if (e.key === "Escape") { if (isWorking) interrupt(); else inputRef.current?.blur(); }
            }}
            placeholder={isWaiting ? "Type y/n or use buttons..." : sessionActive ? "Send a message...   Ctrl+K" : "Start a session...   Ctrl+K"}
            className={`w-full px-3 py-1.5 rounded-lg text-[10px] font-mono text-txt-secondary placeholder:text-txt-tertiary outline-none transition-all focus:ring-1 resize-none overflow-hidden ${isWaiting ? "focus:ring-amber-500/30" : "focus:ring-indigo-500/30"}`}
            style={{ background: "rgba(255, 255, 255, 0.04)", border: `1px solid ${isWaiting ? "rgba(251, 191, 36, 0.15)" : "rgba(255, 255, 255, 0.06)"}` }}
          />
          {isWorking && (
            <div className="absolute right-2.5 bottom-2">
              <div className="w-3 h-3 rounded-full border border-cyan-400/50 border-t-cyan-400 animate-spin" />
            </div>
          )}
        </div>
        {sessionActive && (
          <>
            <button onClick={interrupt} title="Interrupt (Ctrl+C)"
              className="px-2 py-1.5 rounded-lg transition-all text-txt-tertiary/50 hover:text-amber-300/80"
              style={{ background: "transparent", border: "1px solid rgba(255, 255, 255, 0.04)" }}>
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            </button>
            <button onClick={clearTranscript} title="Clear transcript"
              className="px-2 py-1.5 rounded-lg transition-all text-txt-tertiary/50 hover:text-txt-tertiary"
              style={{ background: "transparent", border: "1px solid rgba(255, 255, 255, 0.04)" }}>
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                <polyline points="3 6 5 6 21 6" /><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
              </svg>
            </button>
            <button onClick={endSession} title="End session"
              className="px-2 py-1.5 rounded-lg transition-all text-txt-tertiary/50 hover:text-red-400/80"
              style={{ background: "transparent", border: "1px solid rgba(255, 255, 255, 0.04)" }}>
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                <rect x="3" y="3" width="18" height="18" rx="2" />
              </svg>
            </button>
          </>
        )}
        {!sessionActive && (
          <button onClick={send} disabled={!input.trim()}
            className="px-3 py-1.5 rounded-lg transition-all disabled:opacity-30"
            style={{ background: "rgba(99, 102, 241, 0.20)", border: "1px solid rgba(99, 102, 241, 0.15)", color: "rgba(165, 180, 252, 0.9)" }}>
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
              <line x1="22" y1="2" x2="11" y2="13" /><polygon points="22 2 15 22 11 13 2 9 22 2" />
            </svg>
          </button>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Verify the app compiles**

Run: `npx next build`
Expected: Build succeeds with no TypeScript errors

---

### Task 5: Commit All IPC Changes Together

Tasks 1, 2, and 4 modify the IPC contract atomically — the app is broken between any two of them. Commit them together.

- [ ] **Step 1: Commit**

```bash
git add electron/main.js electron/preload.cjs app/components/Dashboard.tsx
git commit -m "feat: persistent interactive session — replace one-shot command bar"
```

---

### Task 6: Manual Integration Test

- [ ] **Step 1: Start the app**

Run: `npm run start`
Expected: ModelScope launches, command bar shows gray "No Session" pill

- [ ] **Step 2: Test session auto-start**

Type "hello" and press Enter in the command bar.
Expected: Session starts (pill turns green → cyan "Working"), Claude responds in the transcript area, pill returns to green "Active"

- [ ] **Step 3: Test conversation continuity**

Send a follow-up prompt like "what did I just say?"
Expected: Claude references the previous message — proves session persistence

- [ ] **Step 4: Test interrupt**

Send a long prompt, then click the X (interrupt) button or press Escape.
Expected: Claude stops responding, pill returns to green "Active", session stays alive

- [ ] **Step 5: Test end session**

Click the stop (End Session) button.
Expected: Transcript clears, pill returns to gray "No Session"

- [ ] **Step 6: Test drag resize**

Start a new session with output, then drag the handle above the transcript area upward.
Expected: Transcript area grows (up to 50vh max), shrinks back when dragged down

- [ ] **Step 7: Commit final state if any fixes were needed**

```bash
git add -A
git commit -m "fix: integration test adjustments for persistent session"
```
