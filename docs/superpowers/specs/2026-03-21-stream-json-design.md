# Stream-JSON Integration — Design Spec

## Problem

ModelScope currently reads Claude Code's session data from JSONL log files after the fact. This introduces 100-500ms latency, only shows complete turns (not streaming text), and misses real-time token/cost data. The dashboard can't show Claude "typing" or tool calls in progress.

## Solution

Switch to Claude Code's `--output-format stream-json` as the primary data source. Each prompt from ModelScope spawns `claude -p -c --output-format stream-json --verbose` via `child_process.spawn`, receiving structured NDJSON in real-time. The `-c` flag continues the most recent conversation, giving multi-turn continuity. The JSONL file watcher remains as a fallback for externally started sessions.

## Design

### 1. Stream-JSON Session Engine

**Replace node-pty with `child_process.spawn`** in `electron/main.js`.

**Per-prompt process model:** Each user prompt spawns a new process:

```
First prompt:  claude -p --output-format stream-json --verbose
Follow-ups:    claude -p -c --output-format stream-json --verbose
```

The `-p` flag is required — `--output-format stream-json` only works in print mode. The `-c` flag on subsequent prompts resumes the most recent conversation in the working directory, giving multi-turn continuity without a persistent process.

The user's prompt text is piped via stdin (`proc.stdin.write(text); proc.stdin.end()`). The process produces NDJSON on stdout, then exits when done.

**Stdout processing:** Buffer incoming data by newline. Each complete line is parsed as JSON. Based on the `type` field, the engine normalizes and emits typed IPC events to the renderer.

**Field mapping from raw stream-json to normalized IPC payloads:**

| Stream `type` | Raw field path | IPC event | Normalized payload |
|---|---|---|---|
| `system` (subtype `init`) | `session_id`, `model`, `tools`, `cwd` | `stream-event` | `{ type: "init", sessionId: msg.session_id, model: msg.model, tools: msg.tools, cwd: msg.cwd }` |
| `assistant` | `message.content`, `message.usage.*`, `message.model` | `stream-event` | `{ type: "assistant", content: msg.message.content, tokens: { input: msg.message.usage.input_tokens, output: msg.message.usage.output_tokens, cacheRead: msg.message.usage.cache_read_input_tokens \|\| 0, cacheCreation: msg.message.usage.cache_creation_input_tokens \|\| 0 }, model: msg.message.model }` |
| `result` | `total_cost_usd`, `duration_ms`, `is_error`, `result`, `usage` | `stream-event` | `{ type: "result", totalCost: msg.total_cost_usd, durationMs: msg.duration_ms, isError: msg.is_error, result: msg.result, usage: msg.usage }` |
| `rate_limit_event` | `rate_limit_info.status`, `rate_limit_info.resetsAt` | `stream-event` | `{ type: "rateLimit", status: msg.rate_limit_info.status, resetsAt: msg.rate_limit_info.resetsAt }` |

All events go through a single IPC channel `stream-event` with a `type` discriminator. The engine does the snake_case → camelCase conversion and field flattening so the renderer receives clean objects.

**Session state tracking:** The engine tracks `isFirstPrompt` (boolean). First prompt omits `-c`, all subsequent prompts include it. Calling `end-stream-session` resets this flag.

**Process lifecycle per prompt:**
- User sends prompt → engine spawns process, pipes prompt to stdin, closes stdin
- Process streams NDJSON to stdout → engine parses and forwards via IPC
- Process exits → engine sends final `stream-event { type: "done" }`
- While running, a `cancel-stream` IPC kills the process

**Hardware monitor PID tracking:** When the process spawns, call `hardwareMonitor.setRootPid(proc.pid)`. On process exit, call `hardwareMonitor.setRootPid(null)`. The `ChildProcess` object from `spawn` exposes `.pid`.

**Error handling:** Non-zero exit code → emit `stream-event { type: "error", message }`. Invalid JSON lines on stdout → skip silently.

### 2. Data Flow — Primary vs Fallback

**Stream-json (primary):** For prompts sent from ModelScope's command bar:
```
claude -p -c process → stdout NDJSON → main.js line parser → IPC stream-event → renderer → FeedCards + metrics
```
One hop. No socket.io server in the path.

**JSONL file watcher (fallback):** For sessions started externally:
```
.jsonl files → server.js chokidar → parseLine/extractEvent → socket.io → renderer → FeedCards + metrics
```
Same as current. Stays untouched.

Both sources produce the same `FeedCard` types and metrics updates. The renderer accumulates from both.

### 3. Feed Integration

**Converting stream-json `assistant` content blocks to FeedCards:**

The `assistant` event contains `content[]` — an array of content blocks. Each block becomes one or more FeedCards:

| `content[].type` | FeedCard `kind` | Notes |
|---|---|---|
| `"text"` | `"reply"` | Text response from Claude |
| `"tool_use"` where `name` is `Write` or `Edit` | `"code"` | Extract `input.file_path`, `input.content`/`input.old_string`/`input.new_string` |
| `"tool_use"` where `name` is `Bash`, `Grep`, `Glob`, `Read`, etc. | `"tool"` | Extract `name` and `input` for display |
| `"thinking"` | `"thought"` | Only appears with extended thinking beta flag |

The `result` event with `is_error: true` produces a `"error"` FeedCard.

**Metrics accumulation:** Each `assistant` event's token counts are ADDED to the running totals (they are per-turn, not cumulative). The `result` event's `total_cost_usd` is the authoritative cost for the full prompt — add it to the session cost total.

**Rate limit display:** The `rate_limit_event`'s `rate_limit_info.status` and `rate_limit_info.resetsAt` feed into the sidebar usage display.

### 4. Command Bar Changes

The CommandBar switches from the old prompt/response IPC to stream events.

**Per-prompt flow:**
1. User types prompt, hits Enter
2. CommandBar calls `sendStreamPrompt(text)` via IPC
3. Engine spawns `claude -p [-c] --output-format stream-json --verbose`, pipes text to stdin
4. `stream-event` messages arrive — CommandBar appends text content to transcript, updates status pill
5. Process exits — `stream-event { type: "done" }` signals completion
6. Next prompt repeats from step 1 with `-c` flag

**Status pill states:**
- `none` — no prompt running, gray
- `working` — process alive and streaming, cyan
- `done` — process exited, green flash then back to `none`
- `error` — process failed, red

**Permission handling in `-p` mode:** Print mode with `--output-format stream-json` skips the interactive permission dialog. Claude uses its default permission settings. If a tool is denied, the `result` event will contain `permission_denials` array. The command bar can display these but cannot interactively approve — this is a known limitation of `-p` mode. For interactive permission control, users should configure `--dangerously-skip-permissions` or set up `.claude/settings.json` allow lists. This is acceptable for the MVP.

### 5. File Changes

**`electron/main.js` (~80 lines changed):**
- Remove: `node-pty` import (`const pty = require("node-pty")`), all pty-related code (ptyProcess, onData, onExit, permission regex, ANSI stripping)
- Add: `spawn` from `child_process` (already imported as `fork`), stream session engine
- New IPC handlers: `send-stream-prompt` (spawns process, pipes text), `cancel-stream` (kills process), `end-stream-session` (resets `isFirstPrompt`)
- NDJSON line parser that normalizes fields and forwards via `stream-event` IPC
- `hardwareMonitor.setRootPid(proc.pid)` on spawn, `setRootPid(null)` on exit

**`electron/preload.cjs` (~10 lines changed):**
- Remove: `sendPrompt`, `sendToTerminal`, `cancelCommand`, `onPromptResponse`, `removePromptResponse`, `onStatusChange`, `removeStatusChange`
- Add: `sendStreamPrompt(text)`, `cancelStream()`, `endStreamSession()`, `onStreamEvent(callback)`, `removeStreamEvent()`

**`app/components/Dashboard.tsx` (~100 lines changed):**
- CommandBar: rewrite send logic to call `sendStreamPrompt`, listen to `onStreamEvent`
- Add: stream event handler that converts `assistant` content to FeedCards and accumulates metrics
- Remove: old prompt/response/status handlers and types
- Keep: transcript area, status pill, session controls (adapted to new states)

**`package.json`:**
- Remove: `node-pty` from dependencies

**No changes to:** `server.js`, `src/parser.js`, `src/usage-cache.js`, `src/hardware-monitor.js`, `app/globals.css`

### 6. What This Does NOT Change

- JSONL file watcher in server.js — stays as fallback
- Socket.io server — still runs for project list, external sessions, subagent tracking
- Hardware metrics — unchanged (PID tracking migrated from pty to spawn)
- AGENTS tab — unchanged
- Auto-updater — unchanged

### 7. Future Extension (Out of Scope)

- `--input-format stream-json` for structured bidirectional streaming
- Interactive permission handling (requires non `-p` mode)
- Watching external stream-json pipes
- Multiple simultaneous stream-json sessions
- Stream-json data feeding into AGENTS tab subagent tracking
- Extended thinking beta flag (`--betas interleaved-thinking`)
