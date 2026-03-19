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

- First prompt auto-starts the session: `pty.spawn("claude", [], { cwd, env, encoding: "utf8" })`
- Subsequent prompts write directly to the pty: `ptyProcess.write(text + "\r")`
- Session ends when: user clicks End Session, types `/exit`, or the pty process exits
- Working directory defaults to the project directory ModelScope was launched from

**Relationship to the feed:** The feed and sidebar metrics still work via the existing socket.io server watching `~/.claude/projects/`. The pty session and the feed observation are independent and complementary — the feed shows structured event cards, the command bar shows raw terminal conversation.

### 2. Command Bar UI

**Transcript area:**

- Scrollable, append-only transcript of all pty output
- Max height 150px by default, resizable via drag handle up to 50vh
- ANSI escape codes stripped before display
- `overflow-y: auto` — content scrolls within the fixed container

**Session status pill** (left of input):

- `No Session` — gray, no pty running
- `Active` — green pulse, session alive and idle
- `Waiting` — amber pulse, Claude waiting for permission/input
- `Working` — cyan, Claude is processing

**Input behavior:**

- When no session exists, first prompt auto-starts one
- When session is active, Enter writes to pty stdin
- `Shift+Enter` for newlines
- `Escape` to blur input
- `Ctrl+K` global shortcut to focus

**Session controls** (icon buttons in footer):

- End Session (stop icon) — kills pty, clears transcript
- Clear Transcript (trash icon) — clears display, session stays alive
- Raw Toggle (`</>`) — already built, stays

**Permission handling:**

- When pty output matches permission patterns (`[Y/n]`, `allow`, `permission`, etc.), status pill turns amber and Approve/Deny buttons appear
- Approve writes `y\r` to pty, Deny writes `n\r`
- User can also just type `y` or `n` and hit Enter

### 3. Output Parsing & State Detection

**ANSI stripping:** Existing `cleanOutput` regex removes escape codes and carriage returns.

**State detection from pty output:**

- Permission prompt detected → status = `waiting`, amber glow, buttons appear
- User sends input → status = `working`, cyan indicator
- Output stops arriving (debounced 500ms) → status = `active`, green pulse
- Pty exits → status = `none`, gray pill

**No JSON parsing needed.** The interactive session outputs plain text. No `--output-format` flags.

### 4. File Changes

**`electron/main.js`:**

- Remove: `send-prompt` handler (one-shot spawn + `-p` flags)
- Add: `start-session` handler — spawns `claude` in node-pty, keeps reference as `ptyProcess`
- Keep: `send-to-terminal` handler — writes to live pty
- Add: `end-session` handler — kills pty, nulls reference
- Add: sends `session-status` IPC events to renderer on pty state changes
- Keep: permission regex detection on pty output

**`electron/preload.cjs`:**

- Remove: `sendPrompt`
- Add: `startSession(cwd)`, `endSession()`, `onSessionStatus(callback)`, `removeSessionStatus()`
- Keep: `sendToTerminal`, `cancelCommand`, `onPromptResponse`, `onFocusInput`

**`app/components/Dashboard.tsx` — CommandBar component:**

- Remove: `response`, `rawOutput`, `loading`, `status`, `lastPrompt`, `showRaw` split state
- Add: `transcript` (append-only string), `sessionActive` (boolean), `sessionStatus` (enum)
- Add: drag-to-resize handle on transcript area
- Add: session status pill
- Add: End Session / Clear Transcript icon buttons
- Keep: permission Approve/Deny buttons, raw toggle, Ctrl+K focus, expanding textarea

**No changes to:** `server.js`, `src/parser.js`, `src/usage-cache.js`, feed logic, sidebar, settings, LogicMap, or any other Dashboard component.

### 5. Scope Estimate

- `electron/main.js`: ~150 lines changed (simplification — removing one-shot complexity)
- `electron/preload.cjs`: ~20 lines changed
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
