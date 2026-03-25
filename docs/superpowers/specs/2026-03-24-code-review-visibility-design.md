# Code Review Visibility — Design Spec

**Date:** 2026-03-24
**Status:** Approved
**Scope:** Agents tab, Feed, CommandBar

## Problem

ModelScope's purpose is to let humans review Claude's changes in real-time. Two critical gaps exist:

1. **Agents tab** — When an agent is selected, the detail panel shows tool name badges ("Edit", "Write") but never the actual file names, code diffs, or content being changed. The data is stored in `agentEvents` but the UI discards it.

2. **CommandBar transcript** — Tool uses render as raw JSON truncated to 100 chars: `[Edit: {"file_path":"...","old_string":"..."}]`. Unreadable for code review.

3. **Subagent code cards** — Subagent events skip `processEvent()` in the server, so code cards from agents never get `lineInfo` (line numbers) resolved.

## Design

### 1. Agents Tab — Full Feed + Changes View

Replace the agent detail panel's activity list with two sub-tabs:

#### "Activity" sub-tab (default)

Reuse `eventToCards()` + `CardRouter` to render the same rich cards as the main feed. Each event in `agentEvents[id]` produces CodeCards (syntax-highlighted diffs), ToolCards (terminal commands), ReplyCards, ReadCards, etc.

**Requires:** The `AgentEvent` interface must store full `SessionEvent`-shaped data so `eventToCards()` can consume it. Currently it stores a minimal `{ role, text, toolUses: { tool, input }[] }` shape.

**Change `agentEvents` storage** (Dashboard.tsx, `subagent_event` handler ~line 2098):
- Store the raw `SessionEvent` instead of extracting a subset
- `eventToCards()` already handles SessionEvent — no adapter needed

**Render** (AgentsView, ~lines 1106-1123):
- Replace the sparse event list with `cards.map(c => <CardRouter card={c} />)`
- Reuse existing `cardMotion` animation variants

#### "Changes" sub-tab

A file-centric code review view for reviewing all code an agent touched:

- **File list header:** "N files changed, M edits"
- **File entries:** Grouped by file path, sorted by most-recently-edited
  - File name + edit count badge
  - Click to expand/collapse
  - Expanded: all diffs for that file in chronological order
- **Diff rendering:** Reuse `DiffLines` and `CodeLines` components from CodeCard
- **Each diff shows:** timestamp, line range, removed/added content

**Data extraction:** Filter `eventToCards()` output for `kind === "code"`, group by `card.filename`.

**New component:** `AgentChangesView`
- Props: `events: SessionEvent[]`
- Internal state: `expandedFile: string | null`
- Extracts code cards, groups by filename, renders expandable file sections

### 2. Feed — Subagent lineInfo Resolution

**Current:** `checkSubagentLogs()` (server.js ~line 515) emits events directly without calling `processEvent()`. This means:
- No `lineInfo` resolution for Edit tool uses
- No `isNewFile` detection for Write tool uses
- No metrics tracking for subagent activity

**Fix:** Call `processEvent(projectId, event)` for subagent events before emitting. The function already handles all enrichment. After processEvent runs, emit as `"subagent_event"` (processEvent emits as `"event"` too — we need to ensure no duplicate cards on the client).

**Dedup approach:** In `checkSubagentLogs`, call enrichment functions directly instead of full `processEvent` to avoid double-emitting:
- Call `resolveEditLines()` for Edit tool uses
- Set `lineInfo` and `isNewFile` for Write tool uses
- Then emit as `"subagent_event"` only

### 3. CommandBar Transcript

**Current (line 1598):**
```tsx
setTranscript(prev => prev + `\n[${block.name}: ${JSON.stringify(block.input || {}).slice(0, 100)}]\n`);
```

**New:** A `formatToolSummary()` helper that produces human-readable one-liners:

| Tool | Format |
|------|--------|
| Edit | `[Edit: components/Dashboard.tsx]` |
| Write | `[Write: new utils/helpers.ts (45 lines)]` |
| Bash | `[Terminal: npm run build]` |
| Read | `[Read: package.json]` |
| Glob | `[Search: **/*.tsx]` |
| Grep | `[Search: "functionName" in src/]` |
| Agent | `[Agent: "explore codebase"]` |
| Other | `[ToolName: key=value summary]` |

File paths shortened using the existing `shortPath()` logic (last 2 segments).

### 4. Component Architecture

```
AgentsView
  +-- Agent list (left pane, unchanged)
  +-- Agent detail (right pane)
       +-- Sub-tab bar: [Activity] [Changes]
       +-- ActivityFeed (reuses eventToCards + CardRouter)
       +-- AgentChangesView (new)
            +-- File list with expand/collapse
            +-- DiffLines / CodeLines (reused)

CommandBar
  +-- formatToolSummary() helper (new)
```

**No new card components.** All rendering reuses existing CodeCard, DiffLines, CodeLines, CardRouter.

**Modified interfaces:**
- `AgentEvent` → replaced with storing raw `SessionEvent` in `agentEvents` state

**Modified server code:**
- `checkSubagentLogs()` → enrich events with lineInfo before emitting

## Files to Modify

| File | Change |
|------|--------|
| `app/components/Dashboard.tsx` | AgentsView redesign, AgentChangesView component, CommandBar formatToolSummary, agentEvents storage |
| `server.js` | Subagent event enrichment in checkSubagentLogs |

## Out of Scope

- File-level approve/reject actions (future)
- Inline commenting on diffs (future)
- Cross-agent file change aggregation (future)
