# Code Review Visibility Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make agent code changes and file edits visible in the Agents tab, feed, and CommandBar so humans can review Claude's work in real-time.

**Architecture:** Three independent changes: (1) server-side subagent event enrichment with lineInfo, (2) Agents tab redesign with full card feed + file-grouped Changes view, (3) CommandBar transcript formatting. Task 1 must complete before Task 3 (Changes tab depends on lineInfo).

**Tech Stack:** TypeScript/React (Dashboard.tsx), Node.js (server.js), Socket.IO, framer-motion

**Spec:** `docs/superpowers/specs/2026-03-24-code-review-visibility-design.md`

---

### Task 1: Enrich subagent events with lineInfo (server.js)

**Files:**
- Modify: `server.js:508-516` (checkSubagentLogs event loop)

The `checkSubagentLogs` function emits subagent events without enriching Edit/Write tool uses. We add the same enrichment that `processEvent` does (lines 308-320) but without calling full `processEvent` to avoid double-emitting.

- [ ] **Step 1: Add enrichment to checkSubagentLogs**

In `server.js`, replace lines 508-516 (the inner loop of `checkSubagentLogs`):

```javascript
// BEFORE (lines 508-516):
for (const line of lines) {
  const entry = parseLine(line);
  const event = extractEvent(entry);
  if (event && (event.role === "assistant" || event.role === "user")) {
    event.isSubagentEvent = true;
    event.agentId = sa.agentId;
    event.toolUseId = agentIdMap.get(sa.agentId) || sa.agentId;
    emitToProjectViewers(projectId, "subagent_event", event);
  }
}

// AFTER:
for (const line of lines) {
  const entry = parseLine(line);
  const event = extractEvent(entry);
  if (event && (event.role === "assistant" || event.role === "user")) {
    event.isSubagentEvent = true;
    event.agentId = sa.agentId;
    event.toolUseId = agentIdMap.get(sa.agentId) || sa.agentId;

    if (event.role === "assistant" && event.toolUses) {
      for (const tu of event.toolUses) {
        if (tu.tool === "Edit" && tu.input?.file) {
          const info = resolveEditLines(projectId, tu.id, tu.input.file, tu.input.oldString, tu.input.newString, tu.input.replaceAll);
          if (info) tu.lineInfo = info;
        }
        if (tu.tool === "Write" && tu.input?.content) {
          const lineCount = tu.input.content.split("\n").length;
          tu.lineInfo = { startLine: 1, endLine: lineCount, hunks: [{ startLine: 1, lineCount }] };
          try { tu.isNewFile = !fs.existsSync(tu.input.file); } catch { tu.isNewFile = false; }
        }
      }
    }

    emitToProjectViewers(projectId, "subagent_event", event);
  }
}
```

- [ ] **Step 2: Verify server starts without errors**

Run: `node server.js` (check it starts and doesn't crash, then Ctrl+C)

- [ ] **Step 3: Commit**

```bash
git add server.js
git commit -m "feat: enrich subagent events with lineInfo for Edit/Write tools"
```

---

### Task 2: Update agentEvents storage to store full SessionEvent (Dashboard.tsx)

**Files:**
- Modify: `app/components/Dashboard.tsx:1966-1971` (AgentEvent interface)
- Modify: `app/components/Dashboard.tsx:930-933` (AgentsView props)
- Modify: `app/components/Dashboard.tsx:2090-2102` (subagent_event handler)

Replace the minimal `AgentEvent` interface with raw `SessionEvent` storage so `eventToCards()` can consume agent events directly.

- [ ] **Step 1: Remove AgentEvent interface and update types**

Delete the `AgentEvent` interface at lines 1966-1971:

```typescript
// DELETE:
interface AgentEvent {
  role: string;
  text?: string;
  toolUses?: { tool: string; input?: Record<string, unknown> }[];
  timestamp?: string;
}
```

Update `AgentsView` props signature at line 933 — change `agentEvents: Record<string, AgentEvent[]>` to:

```typescript
agentEvents: Record<string, SessionEvent[]>;
```

Update state declaration (find `useState<Record<string, AgentEvent[]>>` near line 2003) to:

```typescript
const [agentEvents, setAgentEvents] = useState<Record<string, SessionEvent[]>>({});
```

- [ ] **Step 2: Update subagent_event handler to store raw SessionEvent**

Replace the handler body at lines 2090-2102. The current code extracts a subset into `AgentEvent`. Instead, store the full event:

```typescript
// BEFORE (lines 2090-2102):
s.on("subagent_event", (ev: SessionEvent & { toolUseId?: string; agentId?: string }) => {
  const newCards = eventToCards(ev); if (!newCards.length) return;
  setCards(p => { const combined = [...p, ...newCards]; return combined.length > MAX_CARDS ? combined.slice(-MAX_CARDS) : combined; });
  setTimeout(scrollBottom, 80);
  const agentKey = ev.toolUseId || ev.agentId || "";
  if (agentKey) {
    setAgentEvents(prev => {
      const events = prev[agentKey] || [];
      const newEvent: AgentEvent = { role: ev.role || "", text: ev.text?.join("\n"), toolUses: ev.toolUses?.map(t => ({ tool: t.tool, input: t.input as Record<string, unknown> | undefined })), timestamp: ev.timestamp };
      const updated = [...events, newEvent];
      return { ...prev, [agentKey]: updated.length > 50 ? updated.slice(-50) : updated };
    });
  }
});

// AFTER:
s.on("subagent_event", (ev: SessionEvent & { toolUseId?: string; agentId?: string }) => {
  const newCards = eventToCards(ev); if (!newCards.length) return;
  setCards(p => { const combined = [...p, ...newCards]; return combined.length > MAX_CARDS ? combined.slice(-MAX_CARDS) : combined; });
  setTimeout(scrollBottom, 80);
  const agentKey = ev.toolUseId || ev.agentId || "";
  if (agentKey) {
    setAgentEvents(prev => {
      const events = prev[agentKey] || [];
      const updated = [...events, ev as SessionEvent];
      return { ...prev, [agentKey]: updated.length > 50 ? updated.slice(-50) : updated };
    });
  }
});
```

- [ ] **Step 3: Verify build succeeds**

Run: `npm run build` (or the project's build command)
Expected: No TypeScript errors

- [ ] **Step 4: Commit**

```bash
git add app/components/Dashboard.tsx
git commit -m "refactor: store full SessionEvent in agentEvents instead of AgentEvent subset"
```

---

### Task 3: Redesign Agents tab with Activity feed + Changes view (Dashboard.tsx)

**Files:**
- Modify: `app/components/Dashboard.tsx:930-1140` (AgentsView function)

This is the largest task. Replace the agent detail panel with two sub-tabs: "Activity" (full card feed) and "Changes" (file-grouped code review).

- [ ] **Step 1: Add sub-tab state and tab bar to AgentsView**

At line 937, after `const [selectedId, setSelectedId] = useState<string | null>(null);`, add:

```typescript
const [detailTab, setDetailTab] = useState<"activity" | "changes">("activity");
```

Also add a reset effect so the tab resets when switching agents:

```typescript
useEffect(() => { setDetailTab("activity"); }, [selectedId]);
```

**Note:** After Task 2, `agentEvents` stores raw `SessionEvent` objects where `text` is `string[]` (not a joined string). This is correct — `eventToCards()` expects `string[]`.

- [ ] **Step 2: Replace the agent detail panel content**

Replace lines 1091-1135 (the `selected ? (...)` block inside the right pane). This is the current sparse event list. Replace with:

```tsx
) : selected ? (
  <div className="flex-1 flex flex-col min-h-0">
    {/* Sub-tab bar */}
    <div className="flex items-center gap-1 px-4 py-2 border-b border-white/[0.06] shrink-0">
      <div className="flex items-center gap-3">
        <div className="flex items-center gap-1.5">
          <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-txt-tertiary"><circle cx="12" cy="12" r="10" /><polyline points="12 6 12 12 16 14" /></svg>
          <span className="text-[9px] font-mono text-txt-secondary">{elapsed(selected.startTime)}</span>
        </div>
        <div className="flex items-center gap-1.5">
          <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-txt-tertiary"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12" /></svg>
          <span className="text-[9px] font-mono text-txt-secondary">{(agentEvents[selected.id] || []).length} events</span>
        </div>
      </div>
      <div className="flex-1" />
      {(["activity", "changes"] as const).map(tab => (
        <button key={tab} onClick={() => setDetailTab(tab)}
          className={`text-[7px] font-sans font-bold tracking-wider uppercase px-2 py-1 rounded-md transition-all ${detailTab === tab ? "bg-indigo-500/20 text-indigo-300" : "text-txt-tertiary hover:text-txt-secondary hover:bg-white/[0.04]"}`}>
          {tab}
        </button>
      ))}
    </div>

    {selected.desc && <p className="text-[9px] font-mono text-txt-secondary/80 leading-relaxed px-4 pt-2">{selected.desc}</p>}

    {/* Activity tab — full card feed */}
    {detailTab === "activity" && (
      <div className="flex-1 overflow-y-auto px-3 py-2 space-y-2">
        {(agentEvents[selected.id] || []).length === 0 && <p className="text-[8px] font-mono text-txt-tertiary">Waiting for events...</p>}
        <AnimatePresence initial={false}>
          {(agentEvents[selected.id] || []).flatMap(ev => eventToCards(ev)).map(card => (
            <motion.div key={card.id} variants={cardMotion} initial="initial" animate="animate" exit="exit" transition={cardTr}>
              <CardRouter card={card} />
            </motion.div>
          ))}
        </AnimatePresence>
      </div>
    )}

    {/* Changes tab — file-grouped code review */}
    {detailTab === "changes" && (
      <AgentChangesView events={agentEvents[selected.id] || []} />
    )}

    {selected.result && (
      <div className="shrink-0 border-t border-white/[0.06] px-4 py-2">
        <span className="text-[7px] font-sans font-bold tracking-[0.15em] uppercase text-txt-tertiary">Result</span>
        <p className="text-[8px] font-mono text-txt-secondary leading-relaxed whitespace-pre-wrap mt-1">{selected.result.slice(0, 500)}{selected.result.length > 500 ? "..." : ""}</p>
      </div>
    )}
  </div>
) : null}
```

- [ ] **Step 3: Build the AgentChangesView component**

Add this new component before the `AgentsView` function (around line 928). It must be placed after `eventToCards` (line 82), `CardRouter` (line 864), `DiffLines` (line 718), `CodeLines` (line 671), and `Timestamp` since it calls all of them:

```tsx
function AgentChangesView({ events }: { events: SessionEvent[] }) {
  const [expandedFile, setExpandedFile] = useState<string | null>(null);

  const codeCards = useMemo(() => {
    const cards: FeedCard[] = [];
    for (const ev of events) cards.push(...eventToCards(ev).filter(c => c.kind === "code"));
    return cards;
  }, [events]);

  const grouped = useMemo(() => {
    const map = new Map<string, FeedCard[]>();
    for (const card of codeCards) {
      const key = card.filename || "unknown";
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(card);
    }
    return Array.from(map.entries()).sort((a, b) => {
      const lastA = a[1][a[1].length - 1]?.timestamp || "";
      const lastB = b[1][b[1].length - 1]?.timestamp || "";
      return lastB.localeCompare(lastA);
    });
  }, [codeCards]);

  const fileCount = grouped.length;
  const changeCount = codeCards.length;

  if (fileCount === 0) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <div className="text-center space-y-2">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="mx-auto text-txt-tertiary/30">
            <path d="M13 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z" /><polyline points="13 2 13 9 20 9" />
          </svg>
          <p className="text-[9px] font-mono text-txt-tertiary">No code changes yet</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-y-auto px-3 py-2">
      <div className="flex items-center gap-2 mb-3">
        <span className="text-[8px] font-mono text-txt-secondary">{fileCount} file{fileCount !== 1 ? "s" : ""} changed</span>
        <span className="text-[8px] font-mono text-txt-tertiary">&middot;</span>
        <span className="text-[8px] font-mono text-txt-tertiary">{changeCount} change{changeCount !== 1 ? "s" : ""}</span>
      </div>

      <div className="space-y-1.5">
        {grouped.map(([filename, cards]) => {
          const isExpanded = expandedFile === filename;
          const editCount = cards.filter(c => !!c.diff).length;
          const writeCount = cards.length - editCount;

          return (
            <div key={filename} className="rounded-lg border border-white/[0.06] overflow-hidden" style={{ background: "rgba(255,255,255,0.015)" }}>
              <button onClick={() => setExpandedFile(isExpanded ? null : filename)}
                className="w-full flex items-center gap-2 px-3 py-2 hover:bg-white/[0.03] transition-colors text-left">
                <svg width="8" height="8" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"
                  className={`text-txt-tertiary transition-transform shrink-0 ${isExpanded ? "rotate-90" : ""}`}>
                  <polyline points="9 18 15 12 9 6" />
                </svg>
                <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="text-txt-secondary shrink-0">
                  <path d="M13 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z" /><polyline points="13 2 13 9 20 9" />
                </svg>
                <span className="text-[9px] font-mono text-txt-secondary truncate flex-1">{filename}</span>
                <div className="flex items-center gap-1 shrink-0">
                  {editCount > 0 && <span className="text-[7px] font-mono px-1.5 py-0.5 rounded bg-amber-500/15 text-amber-400/80">{editCount} edit{editCount !== 1 ? "s" : ""}</span>}
                  {writeCount > 0 && <span className="text-[7px] font-mono px-1.5 py-0.5 rounded bg-emerald-500/15 text-emerald-400/80">{writeCount} write{writeCount !== 1 ? "s" : ""}</span>}
                </div>
              </button>

              <AnimatePresence>
                {isExpanded && (
                  <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={{ duration: 0.25 }}>
                    <div className="border-t border-white/[0.04] px-3 py-2 space-y-2">
                      {cards.map(card => (
                        <div key={card.id}>
                          <div className="flex items-center gap-2 mb-1">
                            <span className={`text-[7px] font-mono font-bold px-1 py-0.5 rounded tracking-wider uppercase ${card.diff ? "bg-amber-500/15 text-amber-400/80" : card.isNewFile ? "bg-emerald-500/20 text-emerald-400" : "bg-emerald-500/15 text-emerald-400/80"}`}>
                              {card.diff ? "diff" : card.isNewFile ? "new" : "write"}
                            </span>
                            {card.lineInfo && <span className="text-[7px] font-mono text-cyan-400/60">L{card.lineInfo.startLine}&ndash;L{card.lineInfo.endLine}</span>}
                            <Timestamp ts={card.timestamp} />
                          </div>
                          <div className="rounded-lg overflow-hidden border border-code-border" style={{ background: "var(--code-bg)" }}>
                            <div className="px-3 py-2 overflow-x-auto">
                              {card.diff
                                ? <DiffLines removed={card.diff.removed} added={card.diff.added} maxLines={20} showLineNums={true} startLine={card.lineInfo?.startLine || 1} />
                                : <CodeLines code={card.code || ""} maxLines={20} showLineNums={true} startLine={card.lineInfo?.startLine || 1} isNewFile={card.isNewFile} />
                              }
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          );
        })}
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Verify build succeeds**

Run: `npm run build`
Expected: No TypeScript errors

- [ ] **Step 5: Commit**

```bash
git add app/components/Dashboard.tsx
git commit -m "feat: redesign Agents tab with full Activity feed and file-grouped Changes view"
```

---

### Task 4: Format CommandBar transcript tool summaries (Dashboard.tsx)

**Files:**
- Modify: `app/components/Dashboard.tsx:1593-1599` (CommandBar onStreamEvent handler)

Replace raw JSON truncation with readable one-liners. The CommandBar receives raw stream-json `block.input` with snake_case keys (`file_path`, `old_string`, `command`).

- [ ] **Step 1: Add formatTranscriptTool helper**

Add this helper near the existing `shortPath` and `formatToolSummary` functions (around line 132):

```typescript
function formatTranscriptTool(name: string, input: Record<string, unknown>): string {
  const sp = (f: unknown) => shortPath(String(f || ""));
  switch (name) {
    case "Edit": return `[Edit: ${sp(input.file_path)}]`;
    case "Write": {
      const lines = typeof input.content === "string" ? input.content.split("\n").length : 0;
      return `[Write: ${sp(input.file_path)} (${lines} lines)]`;
    }
    case "Bash": return `[Terminal: ${String(input.command || input.description || "").slice(0, 80)}]`;
    case "Read": return `[Read: ${sp(input.file_path)}]`;
    case "Glob": return `[Search: ${String(input.pattern || "")}]`;
    case "Grep": {
      const p = String(input.pattern || "");
      const path = input.path ? ` in ${sp(input.path)}` : "";
      return `[Search: "${p}"${path}]`;
    }
    case "Agent": return `[Agent: "${String(input.description || "").slice(0, 60)}"]`;
    default: return `[${name}]`;
  }
}
```

- [ ] **Step 2: Replace the CommandBar transcript line**

Replace line 1598:

```typescript
// BEFORE:
setTranscript(prev => prev + `\n[${block.name}: ${JSON.stringify(block.input || {}).slice(0, 100)}]\n`);

// AFTER:
setTranscript(prev => prev + `\n${formatTranscriptTool(block.name || "Tool", (block.input || {}) as Record<string, unknown>)}\n`);
```

- [ ] **Step 3: Verify build succeeds**

Run: `npm run build`
Expected: No TypeScript errors

- [ ] **Step 4: Commit**

```bash
git add app/components/Dashboard.tsx
git commit -m "feat: format CommandBar transcript with readable tool summaries"
```

---

### Task 5: Smoke test the full flow

- [ ] **Step 1: Start the server and app**

Run: `npm run dev` (or however the project starts both server + electron)

- [ ] **Step 2: Trigger a Claude session with code edits**

Use the CommandBar or run Claude externally in a monitored project. Verify:
- Feed shows CodeCards for Edit/Write with syntax-highlighted diffs
- Subagent code cards show line ranges (L10–L25 style)
- CommandBar transcript shows `[Edit: filename]` instead of raw JSON

- [ ] **Step 3: Check Agents tab**

When agents are active:
- Activity sub-tab shows full card feed (CodeCards, ToolCards, ReplyCards)
- Changes sub-tab shows file list grouped by filename
- Clicking a file expands to show all diffs chronologically
- Header shows "N files changed, M changes"

- [ ] **Step 4: Final commit if any tweaks needed**

```bash
git add -A
git commit -m "fix: polish code review visibility after smoke test"
```
