# Persistent Interactive Session — Design Spec

## Problem

ModelScope's command bar spawns a one-shot `claude -p` process for each prompt. This means:

- No conversation continuity — every prompt starts fresh
- Cannot attach to or interact with running Claude Code sessions
- Permission prompts fail because `-p` mode is non-interactive
- Users must switch to their terminal to steer active sessions

## Solution

Replace the one-shot command bar with a persistent interactive Claude session hosted in a node-pty terminal inside ModelScope. The user types prompts, Claude responds, and the conversation continues — exactly like using Claude Code in a terminal, but embedded in the HUD.

## Design

### 1. Persistent Interactive Session

The command bar launches a long-lived `claude` process (no `-p` flag) via node-pty. The pty stays alive across multiple prompts.

**Session lifecycle:**

- First prompt auto-starts the session
- Subsequent prompts write directly to the pty: `ptyProcess.write(text + "\r")`
- Session ends when: user clicks End Session, types `/exit`, or the pty process exits

**Platform-specific spawn:**

```
Windows:  pty.spawn("cmd.exe", ["/c", "claude"], { ... })
Unix:     pty.spawn("/bin/bash", ["-c", "claude"], { ... })
```

This matches the existing pattern in main.js. The shell wrapper is required on Windows because node-pty cannot resolve bare executable names from PATH.

**Working directory:** The `cwd` for the pty is determined by the active project in ModelScope. The main process reads the active project ID from the socket server's `globalActiveProjectId` and resolves the corresponding directory path. If no project is active, it falls back to `process.cwd()`. The renderer does not pass `cwd` — the main process owns this.

**Relationship to the feed:** The feed and sidebar metrics still work via the existing socket.io server watching `~/.claude/projects/`. The pty session and the feed observation are independent and complementary — the feed shows structured event cards, the command bar shows raw terminal conversation.

### 2. Command Bar UI

**Transcript area:**

- Scrollable, append-only transcript of all pty output
- Max height 150px by default, resizable via drag handle (a 4px horizontal bar above the transcript area, cursor: `row-resize`) up to 50% of `mainWindow`'s current height
- ANSI escape codes stripped before display
- `overflow-y: auto` — content scrolls within the fixed container

**Session status pill** (left of input):

- `none` — gray dot, label "No Session", no pty running
- `active` — green pulse, session alive and idle
- `waiting` — amber pulse, Claude waiting for permission/input
- `working` — cyan, Claude is processing
- `error` — red, pty spawn failed or crashed unexpectedly

Wire format: `session-status` IPC event sends `{ status: "none" | "active" | "waiting" | "working" | "error", message?: string }`.

**Input behavior:**

- When no session exists, first prompt auto-starts one (calls `startSession()` then writes prompt)
- When session is active, Enter writes to pty stdin
- `Shift+Enter` for newlines
- `Escape` sends `Ctrl+C` to the pty (interrupt, not kill) if session is working; blurs input if idle
- `Ctrl+K` global shortcut to focus

**Session controls** (icon buttons in footer):

- End Session (stop icon) — kills pty, clears transcript, status → `none`
- Clear Transcript (trash icon) — clears display, session stays alive
- Interrupt (x icon) — sends `\x03` (Ctrl+C) to pty to cancel current operation without killing session

**Permission handling:**

- When pty output matches permission patterns (`[Y/n]`, `allow`, `permission`, etc.), status → `waiting`, amber glow, Approve/Deny buttons appear
- Approve writes `y\r` to pty, Deny writes `n\r`
- User can also type `y` or `n` and hit Enter
- Permission cooldown: after the user writes to the pty, suppress permission detection for 1 second to prevent Claude's echo output (e.g., "Allowing file access...") from re-triggering the amber state

### 3. Output Parsing & State Detection

**ANSI stripping:** Existing `cleanOutput` regex removes escape codes and carriage returns.

**State detection (all in main.js):**

- Permission prompt detected in pty output → send `session-status: "waiting"`
- User writes to pty → send `session-status: "working"`, start idle timer
- Idle timer: 500ms `setTimeout` in main.js, reset on each `onData` chunk. When it fires without new output, send `session-status: "active"`
- Pty exits normally → send `session-status: "none"`
- Pty spawn fails → catch error, send `session-status: "error"` with `message` describing the failure

**Output to renderer:** Replace `prompt-response` with a single `session-output` IPC event: `{ data: string }`. The renderer appends `data` to its `transcript` string. No `type` field, no `start`/`chunk`/`done` lifecycle.

**No JSON parsing needed.** The interactive session outputs plain text. No `--output-format` flags.

### 4. File Changes

**`electron/main.js`:**

- Remove: `send-prompt` handler, `ANSI_RE`/`cleanOutput`/`PERMISSION_RE` stay but are updated
- Remove: `cancel-command` handler (replaced by `interrupt-session`)
- Add: `start-session` handler — spawns `claude` in node-pty (platform-branched), keeps reference as `ptyProcess`, wraps in try/catch for spawn errors
- Add: `end-session` handler — kills pty, nulls reference, sends `session-status: "none"`
- Add: `interrupt-session` handler — writes `\x03` to pty (Ctrl+C) without killing it
- Add: idle timer (500ms debounce) in `onData` handler for `active` state detection
- Add: permission cooldown (1s suppression after user write)
- Update: `send-to-terminal` stays, also sends `session-status: "working"` and resets idle timer
- Replace: `prompt-response` IPC with `session-output` (just `{ data }`)
- Add: `session-status` IPC sends `{ status, message? }` on state transitions

**`electron/preload.cjs`:**

- Remove: `sendPrompt`, `onPromptResponse`, `removePromptResponse`, `cancelCommand`, `onStatusChange`, `removeStatusChange`
- Add: `startSession()`, `endSession()`, `interruptSession()`
- Add: `onSessionOutput(callback)`, `removeSessionOutput()`
- Add: `onSessionStatus(callback)`, `removeSessionStatus()`
- Keep: `sendToTerminal`, `onFocusInput`, `removeFocusInput`, and all window control methods

**`app/components/Dashboard.tsx` — CommandBar component:**

- Remove: `response`, `rawOutput`, `loading`, `status`, `lastPrompt`, `showRaw`, `error` state variables
- Remove: `onPromptResponse` listener, `onStatusChange` listener
- Remove: raw toggle button (no dual buffer to toggle — transcript is already clean text)
- Add: `transcript` (append-only string), `sessionActive` (boolean), `sessionStatus` (enum matching wire format)
- Add: `onSessionOutput` listener that appends to `transcript`
- Add: `onSessionStatus` listener that updates `sessionStatus`
- Add: drag-to-resize handle on transcript area (4px bar, mousedown/mousemove/mouseup, clamped 150px to 50vh)
- Add: session status pill component
- Add: End Session / Clear Transcript / Interrupt icon buttons
- Update: `send` function — if no session, calls `startSession()` first, then `sendToTerminal(text)`
- Update: `Escape` key — calls `interruptSession()` if working, blurs if idle
- Keep: permission Approve/Deny buttons, `Ctrl+K` focus, expanding textarea

**No changes to:** `server.js`, `src/parser.js`, `src/usage-cache.js`, feed logic, sidebar, settings, LogicMap, or any other Dashboard component.

### 5. Scope Estimate

- `electron/main.js`: ~120 lines changed (simplification — removing one-shot complexity, adding session lifecycle)
- `electron/preload.cjs`: ~25 lines changed
- `Dashboard.tsx` CommandBar: ~200 lines rewritten
- Net complexity reduction — the persistent model is simpler than the one-shot lifecycle

### 6. What This Does NOT Change

- The feed still works via socket.io watching session log files
- Metrics, cost tracking, token counting — all unchanged
- Project switching in the left sidebar — unchanged
- Settings, MAP view, error pinning — unchanged
- Auto-updater — unchanged

### 7. Future Extension (Out of Scope)

- Attach to an externally started Claude Code session (Approach B from brainstorming)
- Multiple simultaneous sessions / tabs
- Session persistence across ModelScope restarts
