# Stream-JSON Integration — Design Spec

## Problem

ModelScope currently reads Claude Code's session data from JSONL log files after the fact. This introduces 100-500ms latency, only shows complete turns (not streaming text), and misses real-time token/cost data. The dashboard can't show Claude "typing" or tool calls in progress.

## Solution

Switch to Claude Code's `--output-format stream-json` as the primary data source. Sessions started from ModelScope spawn `claude --output-format stream-json --verbose` via `child_process.spawn`, receiving structured NDJSON in real-time. The JSONL file watcher remains as a fallback for externally started sessions.

## Design

### 1. Stream-JSON Session Engine

**Replace node-pty with `child_process.spawn`** in `electron/main.js`.

The engine spawns:
```
claude --output-format stream-json --verbose
```

With `stdio: ["pipe", "pipe", "pipe"]`. No shell wrapper needed — `spawn` with `shell: true` resolves `claude` from PATH.

**Stdout processing:** Buffer incoming data by newline. Each complete line is parsed as JSON. Based on the `type` field, the engine emits typed IPC events to the renderer:

| Stream `type` | IPC event | Payload |
|---|---|---|
| `system` (subtype `init`) | `stream-init` | `{ sessionId, model, tools, cwd }` |
| `assistant` | `stream-assistant` | `{ content: [{type, text?, toolUse?}], tokens: {input, output, cacheRead, cacheCreation}, costUSD, model }` |
| `result` | `stream-result` | `{ totalCost, durationMs, usage, isError, result }` |
| `rate_limit_event` | `stream-rate-limit` | `{ status, resetsAt, isUsingOverage }` |

The engine extracts and normalizes the fields from the raw stream-json format. The renderer receives clean, typed objects.

**Stdin for follow-up prompts:** When the user sends a message from the command bar, the engine writes the text + `\n` to the spawned process's stdin. Claude treats it as the next user turn. The conversation continues in the same process.

**Session lifecycle:**
- `start-stream-session` IPC → spawns the process, begins streaming
- `send-stream-input` IPC → writes text to stdin
- `end-stream-session` IPC → kills the process, cleans up
- Process exit (natural or error) → sends `stream-result` with final state

**Error handling:** If the process exits with a non-zero code, emit a `stream-result` with `isError: true`. If stdout produces invalid JSON lines, skip them silently (stderr output from Claude sometimes intermixes).

### 2. Data Flow — Primary vs Fallback

**Stream-json (primary):** For sessions started from ModelScope's command bar:
```
claude process → stdout NDJSON → main.js line parser → IPC → renderer → FeedCards + metrics
```
One hop. No socket.io server in the path.

**JSONL file watcher (fallback):** For sessions started externally:
```
.jsonl files → server.js chokidar → parseLine/extractEvent → socket.io → renderer → FeedCards + metrics
```
Same as current. Stays untouched.

Both sources produce the same `FeedCard` types and metrics updates. The renderer doesn't distinguish between them — cards from either source go into the same `cards` array.

### 3. Feed Integration

**Converting stream-json to FeedCards:**

| Stream-json content | FeedCard `kind` |
|---|---|
| `content[].type === "text"` | `"reply"` |
| `content[].type === "tool_use"` where tool is Write/Edit | `"code"` |
| `content[].type === "tool_use"` where tool is Bash/Grep/Glob/Read/etc | `"tool"` |
| `content[].type === "thinking"` | `"thought"` |
| `result` with `is_error: true` | `"error"` |

**Metrics from stream-json:** The `assistant` message contains `usage.input_tokens`, `usage.output_tokens`, `usage.cache_read_input_tokens`. The `result` message contains `total_cost_usd` and `duration_ms`. These update the sidebar metrics state directly in the renderer — no need for the server to compute them.

**Rate limit display:** The `rate_limit_event` contains `resetsAt` and `status`. This feeds directly into the sidebar's usage display, giving more accurate rate limit info than the current cached `/usage` approach.

### 4. Command Bar Changes

The CommandBar component switches from the old `sendPrompt`/`onPromptResponse` IPC to the new stream IPC.

**Session auto-start:** First prompt starts a stream session (calls `startStreamSession()`), waits for `stream-init`, then sends the prompt via `sendStreamInput(text)`.

**Streaming display:** As `stream-assistant` events arrive, the command bar's transcript area shows text content in real-time. Tool calls show as compact badges. The status pill reflects the session state based on which events are flowing.

**Permission handling:** If Claude requests a tool use that needs permission, the `assistant` message will contain the tool_use content block. The next `result` or error will indicate if it was denied. The command bar can detect this and show the Approve/Deny UI.

### 5. External Session Watching

For sessions started outside ModelScope (in a terminal), the user can pipe stream-json to a file that ModelScope watches:

```bash
claude --output-format stream-json --verbose 2>&1 | tee ~/.claude/modelscope-stream.jsonl
```

Or ModelScope can detect external sessions via the existing JSONL watcher and display them with turn-level granularity (current behavior, no change).

This is a future enhancement — for the MVP, external sessions use the existing JSONL fallback.

### 6. File Changes

**`electron/main.js` (~80 lines changed):**
- Remove: `node-pty` import, all pty-related code
- Add: `child_process.spawn` session engine with NDJSON line parser
- New IPC handlers: `start-stream-session`, `send-stream-input`, `end-stream-session`
- Forward parsed stream events as typed IPC: `stream-init`, `stream-assistant`, `stream-result`, `stream-rate-limit`

**`electron/preload.cjs` (~10 lines changed):**
- Remove: old command bar IPC methods (`sendPrompt`, `onPromptResponse`, `removePromptResponse`, `cancelCommand`, `onStatusChange`, `removeStatusChange`)
- Add: `startStreamSession()`, `sendStreamInput(text)`, `endStreamSession()`, `onStreamEvent(callback)`, `removeStreamEvent()`

**`app/components/Dashboard.tsx` (~100 lines changed):**
- CommandBar: rewrite to use stream IPC
- Add: `onStreamEvent` listener that converts stream messages to FeedCards and metrics
- Remove: old `onPromptResponse`/`onStatusChange` handlers

**`package.json`:**
- Remove: `node-pty` from dependencies

**No changes to:** `server.js`, `src/parser.js`, `src/usage-cache.js`, `src/hardware-monitor.js`, `app/globals.css`

### 7. What This Does NOT Change

- JSONL file watcher in server.js — stays as fallback
- Socket.io server — still runs for project list, external sessions
- Hardware metrics — unchanged
- AGENTS tab — unchanged (subagent tracking still via socket.io)
- Auto-updater — unchanged

### 8. Future Extension (Out of Scope)

- Watching external stream-json pipes (tee'd files)
- `--input-format stream-json` for structured prompt sending
- Multiple simultaneous stream-json sessions
- Stream-json data feeding into the AGENTS tab subagent tracking
