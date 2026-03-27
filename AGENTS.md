# AGENTS.md

## Cursor Cloud specific instructions

### Overview
ModelScope is an Electron/Next.js desktop app that monitors Claude Code sessions in real-time. It reads `.jsonl` session logs from `~/.claude/projects/` and displays a dashboard with token metrics, cost, tool usage, and a live event feed.

### Running in development
The project uses **npm** (lockfile: `package-lock.json`) and **Node 20+**.

- **Backend server** (port 3778): `node server.js` — Socket.IO + HTTP server that watches `~/.claude/projects/` for session data.
- **Next.js frontend** (port 3777): `npm run dev` — Serves the React dashboard UI.
- **Full desktop stack** (optional): `npm start` — Runs backend + frontend + Electron concurrently.
- Electron is optional for development; the dashboard works in a regular browser at `http://localhost:3777`.

### Key caveats
- The backend requires `~/.claude/projects/` to exist. Create it before starting: `mkdir -p ~/.claude/projects`
- To see data in the dashboard, place `.jsonl` session files in `~/.claude/projects/<project-name>/`.
- **Do not run `npm run build` before `npm run dev`**: the static export (`out/` directory) can conflict with the Next.js dev server. If you encounter "Internal Server Error", remove `out/` and `.next/` then restart `npm run dev`.
- There is no ESLint config or lint script. TypeScript checking is done via `npx tsc --noEmit` or implicitly during `npm run build`.
- The CI workflow (`.github/workflows/build.yml`) targets Node 20 and runs `npm ci && npm run build`.

### Testing
No automated test suite exists. Validate with:
- `npx tsc --noEmit` — TypeScript type check
- `npm run build` — Full Next.js production build (includes type-checking)
- Manual browser testing at `http://localhost:3777` with mock `.jsonl` data in `~/.claude/projects/`
