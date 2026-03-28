# Cloud Agents Starter Skill (ModelScope)

Use this skill when you need to quickly run, debug, or test this repository in Cursor Cloud.

## 1) Quick setup (do this first)

1. Install dependencies:
   - `npm ci`
2. Verify key CLIs:
   - `node -v`
   - `npm -v`
   - `claude --version` (required for command-bar streaming features)
3. Required login for command-bar features:
   - `claude login`
4. Optional local data sources:
   - Claude sessions live under `~/.claude/projects` (used by `server.js` and `src/watcher.js`).
   - Cursor AI metrics DB is `~/.cursor/ai-tracking/ai-code-tracking.db` (optional; app handles missing DB).

## 2) Codebase areas and practical run/test workflows

### A. Web UI (`app/`, especially `app/components/Dashboard.tsx`)

Run:
- `npm run dev` (Next dev server on `http://localhost:3777`)

Test workflow:
1. Open `http://localhost:3777`.
2. Confirm the dashboard renders (cards/sidebar/tabs visible).
3. If you changed UI logic or TypeScript types, run:
   - `npm run build`
4. If your change is visual, capture a screenshot/video from the running UI.

### B. Realtime backend (`server.js`, `src/parser.js`, `src/usage-cache.js`, `src/cursor-metrics.js`)

Run:
- `npm run server` (Socket/HTTP server on `http://localhost:3778`)

Test workflow:
1. Health/smoke endpoints:
   - `curl -s http://localhost:3778/projects`
   - `curl -s http://localhost:3778/scan-directory`
2. Mock usage metrics (without waiting for real `/usage` output):
   - `curl -s -X POST http://localhost:3778/usage-update -H "Content-Type: application/json" -d '{"sessionPercent":42,"weeklyPercent":13,"resetLabel":"Resets in 2 hr 0 min","source":"manual-test"}'`
3. Re-open UI and verify the usage section updates.

### C. Electron shell + command bar (`electron/main.js`, `electron/preload.cjs`)

Run all app parts together:
- `npm run start` (server + web + electron)

Run components separately (useful when debugging startup):
- Terminal 1: `npm run server`
- Terminal 2: `npm run dev`
- Terminal 3: `npm run electron`

Test workflow:
1. Ensure `claude login` was completed.
2. Launch app (`npm run start` or split mode).
3. In command bar, submit a short prompt.
4. Confirm stream cards appear and finish cleanly (no "Failed to start Claude CLI" errors).
5. Trigger cancel once and verify session can still accept a new prompt.

### D. Session observer/parsing CLI (`src/watcher.js`, `src/parser.js`)

Run:
- `npm run parse`

Test workflow:
1. Start `npm run parse`.
2. In another terminal, run a Claude command in any repo to produce/update session logs.
3. Confirm the watcher prints live events and metrics (turns/tokens/cost).
4. If parser logic changed, verify both:
   - user text extraction
   - assistant tool call summaries

### E. Cursor metrics integration (`src/cursor-metrics.js`)

Behavior:
- Reads `~/.cursor/ai-tracking/ai-code-tracking.db` in read-only mode.
- Returns `null` if DB is missing/unreadable (expected in many cloud containers).

Test workflow:
1. Run server + UI.
2. Validate app still works when DB is absent (no crash; metrics section gracefully empty/unknown).
3. If DB exists, confirm values populate (`aiPercentage`, `topFiles`, commit rows).

## 3) Feature flags and mocking notes

There are no formal env-based feature flags in this repo right now. Use these practical toggles/mocks instead:

1. Usage/rate-limit style UI state:
   - Mock with `POST /usage-update` (shown above).
2. Project/session presence:
   - Real path is `~/.claude/projects`; easiest way to seed data is running one real Claude prompt after `claude login`.
3. Cursor metrics:
   - Presence/absence of `~/.cursor/ai-tracking/ai-code-tracking.db` is the effective on/off switch.
4. UI behavior toggles:
   - Use in-app Settings switches for workflow checks (no rebuild required).

## 4) Common cloud-agent workflows

### UI-only change
1. `npm run dev`
2. Verify in browser
3. `npm run build`
4. Save screenshot/video artifact

### Server/parser change
1. `npm run server`
2. Exercise `/projects`, `/scan-directory`, `/usage-update`
3. Verify corresponding UI updates in `npm run dev`

### Electron/command-bar change
1. `claude login`
2. `npm run start`
3. Send prompt, test cancel, send second prompt (continuation behavior)

## 5) How to keep this skill updated

When you discover a new runbook trick, add it immediately in this file:

1. Put it under the relevant codebase area section.
2. Include exact command(s) and expected output/signals.
3. Note any prerequisite (login, data file, port, OS caveat).
4. Add one short failure signature ("if broken, you will see ...").
5. Remove stale commands whenever scripts/ports/paths change.

Keep updates short and operational; prefer copy-paste-ready commands over prose.
