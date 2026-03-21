# Stream-JSON Integration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace node-pty with child_process.spawn using Claude's stream-json output format as ModelScope's primary real-time data source.

**Architecture:** Each prompt spawns `claude -p [-c] --output-format stream-json --verbose` via child_process.spawn, piping the prompt via stdin. The NDJSON stdout is parsed line-by-line, normalized from snake_case to camelCase, and forwarded to the renderer via a single `stream-event` IPC channel. The renderer converts stream events into FeedCards and accumulates metrics.

**Tech Stack:** child_process.spawn, NDJSON line parsing, Electron IPC, React state

---

## File Structure

| File | Action | Responsibility |
|------|--------|---------------|
| `electron/main.js` | Modify | Replace pty with spawn-based stream engine, NDJSON parser, new IPC handlers |
| `electron/preload.cjs` | Modify | Replace old command IPC with stream IPC methods |
| `app/components/Dashboard.tsx` | Modify | Rewrite CommandBar for stream events, add FeedCard conversion |
| `package.json` | Modify | Remove node-pty dependency |

---

### Task 1: Replace node-pty with Stream Engine in main.js

**Files:**
- Modify: `electron/main.js:5-10` (imports), `electron/main.js:115-187` (pty code block)

- [ ] **Step 1: Update imports**

At line 5, change:
```javascript
import { fork } from "child_process";
```
To:
```javascript
import { fork, spawn } from "child_process";
```

At line 10, remove:
```javascript
const pty = require("node-pty");
```

- [ ] **Step 2: Replace pty code block with stream engine**

Delete lines 115-187 (everything from `let ptyProcess = null;` through the `cancel-command` handler's closing `});`). Replace with:

```javascript
  let activeProc = null;
  let isFirstPrompt = true;

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
      if (buffer.trim()) {
        const parsed = parseStreamLine(buffer);
        if (parsed) mainWindow?.webContents.send("stream-event", parsed);
      }
      if (hardwareMonitor) hardwareMonitor.setRootPid(null);
      mainWindow?.webContents.send("stream-event", { type: "done", exitCode: code });
      activeProc = null;
      isFirstPrompt = false;
    });
  });

  ipcMain.on("cancel-stream", () => {
    if (activeProc) {
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
```

- [ ] **Step 3: Verify syntax**

Run: `node --check electron/main.js`
Expected: no output

- [ ] **Step 4: Commit**

```bash
git add electron/main.js
git commit -m "feat: replace node-pty with stream-json spawn engine"
```

---

### Task 2: Update Preload Bridge

**Files:**
- Modify: `electron/preload.cjs` (replace command IPC methods)

- [ ] **Step 1: Rewrite preload.cjs**

Replace the entire file with:

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
```

- [ ] **Step 2: Commit**

```bash
git add electron/preload.cjs
git commit -m "feat: update preload bridge for stream-json IPC"
```

---

### Task 3: Rewrite CommandBar for Stream Events

**Files:**
- Modify: `app/components/Dashboard.tsx` (CommandBar component, around line 1580)

- [ ] **Step 1: Replace the CommandBar function**

Find `function CommandBar()` (around line 1580). Delete the entire function through its closing `}`. Replace with:

```tsx
function CommandBar() {
  const [input, setInput] = useState("");
  const [transcript, setTranscript] = useState("");
  const [status, setStatus] = useState<"none" | "working" | "error">("none");
  const [sessionActive, setSessionActive] = useState(false);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const transcriptRef = useRef<HTMLDivElement>(null);

  type StreamAPI = {
    sendStreamPrompt: (t: string) => void;
    cancelStream: () => void;
    endStreamSession: () => void;
    onStreamEvent: (cb: (d: { type: string; content?: { type: string; text?: string; name?: string; input?: Record<string, unknown> }[]; tokens?: { input: number; output: number; cacheRead: number; cacheCreation: number }; model?: string; totalCost?: number; durationMs?: number; isError?: boolean; result?: string; exitCode?: number }) => void) => void;
    removeStreamEvent: () => void;
    onFocusInput: (cb: () => void) => void;
    removeFocusInput: () => void;
  };

  const getApi = () => (window as unknown as Record<string, StreamAPI>).electronAPI;

  useEffect(() => {
    const api = getApi();
    if (!api) return;

    api.onFocusInput(() => { inputRef.current?.focus(); });

    api.onStreamEvent((msg) => {
      if (msg.type === "init") {
        setSessionActive(true);
      } else if (msg.type === "assistant" && msg.content) {
        setStatus("working");
        for (const block of msg.content) {
          if (block.type === "text" && block.text) {
            setTranscript(prev => prev + block.text);
          }
          if (block.type === "tool_use") {
            setTranscript(prev => prev + `\n[${block.name}: ${JSON.stringify(block.input || {}).slice(0, 100)}]\n`);
          }
        }
      } else if (msg.type === "result") {
        if (msg.isError) {
          setStatus("error");
          setTranscript(prev => prev + `\nError: ${msg.result || "Unknown error"}\n`);
        }
        setSessionActive(true);
      } else if (msg.type === "done") {
        setStatus("none");
        inputRef.current?.focus();
      }
    });

    return () => {
      api.removeStreamEvent();
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
    if (!text || status === "working") return;
    const api = getApi();
    if (!api) return;
    setTranscript(prev => prev + (prev ? "\n" : "") + "> " + text + "\n");
    setStatus("working");
    api.sendStreamPrompt(text);
    setInput("");
    if (inputRef.current) inputRef.current.style.height = "auto";
  };

  const cancel = () => {
    const api = getApi();
    if (!api) return;
    api.cancelStream();
  };

  const endSession = () => {
    const api = getApi();
    if (!api) return;
    api.endStreamSession();
    setTranscript("");
    setSessionActive(false);
  };

  const isWorking = status === "working";

  return (
    <div className={`no-drag shrink-0 border-t border-white/[0.08] transition-all duration-300 ${isWorking ? "cmd-thinking" : ""}`} style={{ background: "rgba(0, 0, 0, 0.40)", backdropFilter: "blur(24px) saturate(150%)" }}>
      {transcript && (
        <div ref={transcriptRef} className="px-3 pt-2 pb-1 max-h-[150px] overflow-y-auto">
          <pre className="text-[9px] font-mono text-indigo-200/70 leading-relaxed whitespace-pre-wrap break-words">{transcript}</pre>
        </div>
      )}
      <div className="flex items-end gap-2 px-3 py-2">
        <div className="flex items-center gap-1.5 shrink-0 self-center">
          <div className={`w-2 h-2 rounded-full ${isWorking ? "bg-cyan-400 animate-pulse" : status === "error" ? "bg-red-400" : sessionActive ? "bg-green-400" : "bg-white/20"}`} />
          <span className="text-[7px] font-mono text-txt-tertiary w-[40px]">{isWorking ? "Stream" : sessionActive ? "Ready" : "Idle"}</span>
        </div>
        <div className="relative flex-1">
          <textarea
            ref={inputRef}
            rows={1}
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={e => {
              if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); }
              if (e.key === "Escape") { if (isWorking) cancel(); else inputRef.current?.blur(); }
            }}
            placeholder={isWorking ? "Streaming..." : "Send a prompt...   Ctrl+K"}
            className="w-full px-3 py-1.5 rounded-lg text-[10px] font-mono text-txt-secondary placeholder:text-txt-tertiary outline-none transition-all focus:ring-1 focus:ring-indigo-500/30 resize-none overflow-hidden"
            style={{ background: "rgba(255, 255, 255, 0.04)", border: "1px solid rgba(255, 255, 255, 0.06)" }}
          />
          {isWorking && (
            <div className="absolute right-2.5 bottom-2">
              <div className="w-3 h-3 rounded-full border border-cyan-400/50 border-t-cyan-400 animate-spin" />
            </div>
          )}
        </div>
        {isWorking ? (
          <button onClick={cancel} className="px-3 py-1.5 rounded-lg transition-all"
            style={{ background: "rgba(239, 68, 68, 0.20)", border: "1px solid rgba(239, 68, 68, 0.15)", color: "rgba(252, 165, 165, 0.9)" }}>
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
              <rect x="3" y="3" width="18" height="18" rx="2" />
            </svg>
          </button>
        ) : (
          <button onClick={send} disabled={!input.trim()}
            className="px-3 py-1.5 rounded-lg transition-all disabled:opacity-30"
            style={{ background: "rgba(99, 102, 241, 0.20)", border: "1px solid rgba(99, 102, 241, 0.15)", color: "rgba(165, 180, 252, 0.9)" }}>
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
              <line x1="22" y1="2" x2="11" y2="13" /><polygon points="22 2 15 22 11 13 2 9 22 2" />
            </svg>
          </button>
        )}
        {sessionActive && (
          <button onClick={endSession} title="End session"
            className="px-2 py-1.5 rounded-lg transition-all text-txt-tertiary/50 hover:text-red-400/80"
            style={{ background: "transparent", border: "1px solid rgba(255, 255, 255, 0.04)" }}>
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <path d="M18.36 6.64A9 9 0 1 1 5.64 5.64" /><line x1="12" y1="2" x2="12" y2="12" />
            </svg>
          </button>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Verify build**

Run: `npx next build`
Expected: Build succeeds

- [ ] **Step 3: Commit**

```bash
git add app/components/Dashboard.tsx
git commit -m "feat: rewrite CommandBar for stream-json events"
```

---

### Task 4: Remove node-pty Dependency

**Files:**
- Modify: `package.json`

- [ ] **Step 1: Uninstall node-pty**

Run: `npm uninstall node-pty`
Expected: package.json updated, node_modules cleaned

- [ ] **Step 2: Verify everything still works**

Run: `node --check electron/main.js && npx next build`
Expected: both pass

- [ ] **Step 3: Commit**

```bash
git add package.json package-lock.json
git commit -m "chore: remove node-pty dependency"
```

---

### Task 5: Manual Integration Test

- [ ] **Step 1: Start the app**

Run: `npm run start`
Expected: ModelScope launches, command bar shows gray "Idle" dot

- [ ] **Step 2: Send first prompt**

Type "What is 2+2?" and hit Enter.
Expected: Status dot turns cyan "Stream", transcript shows "> What is 2+2?" then Claude's streamed response appears in real-time. When done, dot returns to green "Ready".

- [ ] **Step 3: Test conversation continuity**

Send a follow-up: "What did I just ask you?"
Expected: Claude references the previous question (proves `-c` flag works for multi-turn)

- [ ] **Step 4: Test cancel**

Send a long prompt, then click the stop button or press Escape.
Expected: Process killed, dot returns to idle, transcript shows what was received before cancellation.

- [ ] **Step 5: Test end session**

Click the end session button (power icon).
Expected: Transcript clears, dot goes gray "Idle". Next prompt starts a fresh session (no `-c`).

- [ ] **Step 6: Verify feed still works via JSONL fallback**

Switch to a different project in the session panel. Check the FEED tab.
Expected: Feed cards still appear from the JSONL file watcher for externally running sessions.

- [ ] **Step 7: Commit final state**

```bash
git add -A
git commit -m "feat: stream-json integration — complete"
```
