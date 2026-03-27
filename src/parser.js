import fs from "fs";
import path from "path";
import os from "os";

const PRICING = {
  "claude-opus-4-6":           { input: 5 / 1e6, output: 25 / 1e6, cacheRead: 0.5 / 1e6, cacheWrite: 6.25 / 1e6 },
  "claude-opus-4-5-20251101":  { input: 15 / 1e6, output: 75 / 1e6, cacheRead: 1.5 / 1e6, cacheWrite: 18.75 / 1e6 },
  "claude-sonnet-4-6":         { input: 3 / 1e6,  output: 15 / 1e6, cacheRead: 0.3 / 1e6, cacheWrite: 3.75 / 1e6 },
  "claude-haiku-4-5-20251001": { input: 1 / 1e6, output: 5 / 1e6, cacheRead: 0.1 / 1e6, cacheWrite: 1.25 / 1e6 },
};
const DEFAULT_PRICING = PRICING["claude-opus-4-6"];

const CONTEXT_PATTERNS = {
  "CLAUDE.md":    "Project Rules",
  "MEMORY.md":    "Memory",
  ".claude/":     "Config",
  "package.json": "Manifest",
  "tsconfig":     "Config",
  ".env":         "Env",
};

export function findNewestSession(claudeDir) {
  const projectsDir = path.join(claudeDir, "projects");
  if (!fs.existsSync(projectsDir)) return null;

  let newest = null;
  let newestMtime = 0;

  for (const projDir of fs.readdirSync(projectsDir)) {
    const projPath = path.join(projectsDir, projDir);
    if (!fs.statSync(projPath).isDirectory()) continue;

    for (const file of fs.readdirSync(projPath)) {
      if (!file.endsWith(".jsonl")) continue;
      const filePath = path.join(projPath, file);
      const stat = fs.statSync(filePath);
      if (stat.mtimeMs > newestMtime) {
        newestMtime = stat.mtimeMs;
        newest = { path: filePath, project: projDir, sessionId: file.replace(".jsonl", ""), mtime: stat.mtime };
      }
    }
  }
  return newest;
}

export function findSubagentLogs(sessionFilePath) {
  const sessionDir = path.dirname(sessionFilePath);
  const subDir = path.join(sessionDir, "subagents");
  if (!fs.existsSync(subDir)) return [];

  return fs.readdirSync(subDir)
    .filter(f => f.endsWith(".jsonl"))
    .map(f => {
      const agentId = f.replace(".jsonl", "").replace("agent-", "");
      return { path: path.join(subDir, f), agentId };
    });
}

export function parseLine(raw) {
  try { return JSON.parse(raw); } catch { return null; }
}

function inferReadSource(filePath, callerType) {
  if (!filePath) return null;
  const normalized = filePath.replace(/\\/g, "/");

  if (callerType === "search" || callerType === "grep_result") return "Search Result";
  if (callerType === "pinned" || callerType === "at_mention") return "Pinned";

  for (const [pattern, label] of Object.entries(CONTEXT_PATTERNS)) {
    if (normalized.includes(pattern)) return label;
  }

  return "Direct";
}

export function extractEvent(entry) {
  if (!entry || entry.type === "file-history-snapshot") return null;

  const base = {
    uuid: entry.uuid,
    parentUuid: entry.parentUuid,
    timestamp: entry.timestamp,
    type: entry.type,
    sessionId: entry.sessionId,
    isSidechain: entry.isSidechain || false,
    agentId: entry.agentId || null,
  };

  if (entry.type === "system") {
    return { ...base, subtype: entry.subtype, content: entry.content };
  }

  if (entry.type === "rate_limit_event" && entry.rate_limit_info) {
    return {
      ...base,
      type: "rateLimit",
      status: entry.rate_limit_info.status || "unknown",
      resetsAt: entry.rate_limit_info.resetsAt || "",
    };
  }

  if (entry.type === "user" && entry.message?.role === "user") {
    const msg = entry.message;
    const blocks = Array.isArray(msg.content) ? msg.content : [{ type: "text", text: msg.content }];
    const toolResults = blocks.filter(b => b.type === "tool_result");
    const textBlocks = blocks.filter(b => b.type === "text");

    return {
      ...base,
      role: "user",
      isMeta: entry.isMeta || false,
      toolResults: toolResults.map(tr => ({
        toolUseId: tr.tool_use_id,
        content: typeof tr.content === "string" ? tr.content.slice(0, 200) : JSON.stringify(tr.content).slice(0, 200),
        isError: tr.is_error || false,
      })),
      text: textBlocks.map(b => b.text).join("\n").slice(0, 300),
    };
  }

  if (entry.type === "assistant" && entry.message?.role === "assistant") {
    const msg = entry.message;
    const usage = msg.usage || {};
    const model = msg.model || "unknown";
    const blocks = Array.isArray(msg.content) ? msg.content : [];

    const thinking = blocks.filter(b => b.type === "thinking").map(b => b.thinking).filter(Boolean);
    const text = blocks.filter(b => b.type === "text").map(b => b.text);
    const toolUses = blocks.filter(b => b.type === "tool_use").map(b => {
      const callerType = b.caller?.type || "direct";
      const summary = summarizeToolInput(b.name, b.input);

      return {
        tool: b.name,
        id: b.id,
        input: summary,
        callerType,
        ...(b.name === "Agent" ? {
          isSubagent: true,
          subagentType: b.input?.subagent_type || "general-purpose",
          subagentDesc: b.input?.description || "",
          subagentBackground: b.input?.run_in_background || false,
        } : {}),
        ...(b.name === "Read" ? {
          readSource: inferReadSource(b.input?.file_path, callerType),
        } : {}),
      };
    });

    const tokens = {
      input: usage.input_tokens || 0,
      output: usage.output_tokens || 0,
      cacheRead: usage.cache_read_input_tokens || 0,
      cacheWrite: usage.cache_creation_input_tokens || 0,
    };

    const rates = PRICING[model] || DEFAULT_PRICING;
    const costInTokens =
      tokens.input * rates.input +
      tokens.output * rates.output +
      tokens.cacheRead * rates.cacheRead +
      tokens.cacheWrite * rates.cacheWrite;

    return {
      ...base,
      role: "assistant",
      model,
      stopReason: msg.stop_reason,
      thinking: thinking.length ? thinking : undefined,
      text: text.length ? text : undefined,
      toolUses: toolUses.length ? toolUses : undefined,
      tokens,
      costUSD: Math.round(costInTokens * 1e6) / 1e6,
    };
  }

  return base;
}

function summarizeToolInput(toolName, input) {
  if (!input) return null;
  switch (toolName) {
    case "Bash":
      return { command: input.command, description: input.description };
    case "Read":
      return { file: input.file_path };
    case "Write":
      return { file: input.file_path, lines: (input.content || "").split("\n").length, content: (input.content || "").slice(0, 1200) };
    case "Edit":
      return { file: input.file_path, oldString: (input.old_string || "").slice(0, 600), newString: (input.new_string || "").slice(0, 600), replaceAll: input.replace_all || false };
    case "Glob":
      return { pattern: input.pattern, path: input.path };
    case "Grep":
      return { pattern: input.pattern, path: input.path, outputMode: input.output_mode };
    case "Agent":
      return { description: input.description, type: input.subagent_type, background: input.run_in_background };
    default:
      return Object.fromEntries(Object.entries(input).map(([k, v]) => [k, typeof v === "string" ? v.slice(0, 100) : v]));
  }
}

export function parseSubagentSummary(logPath) {
  try {
    const raw = fs.readFileSync(logPath, "utf-8");
    const lines = raw.trim().split("\n").filter(Boolean);
    let turns = 0, toolCalls = 0, lastText = "";

    for (const line of lines) {
      const entry = parseLine(line);
      if (!entry || entry.type !== "assistant") continue;
      const blocks = Array.isArray(entry.message?.content) ? entry.message.content : [];
      const texts = blocks.filter(b => b.type === "text").map(b => b.text);
      const tools = blocks.filter(b => b.type === "tool_use");
      if (texts.length) { turns++; lastText = texts.join(" "); }
      toolCalls += tools.length;
    }

    return { turns, toolCalls, entries: lines.length, lastText: lastText.slice(0, 200) };
  } catch {
    return null;
  }
}

const isMainModule = process.argv[1] && path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname.replace(/^\/([A-Z]:)/, "$1"));

if (isMainModule) {
  const claudeDir = path.join(os.homedir(), ".claude");
  const session = findNewestSession(claudeDir);
  if (!session) { console.error("No session files found"); process.exit(1); }
  console.log(`Session: ${session.sessionId}`);
  console.log(`Project: ${session.project}`);

  const subagents = findSubagentLogs(session.path);
  if (subagents.length) {
    console.log(`\nSubagents: ${subagents.length}`);
    for (const sa of subagents) {
      const summary = parseSubagentSummary(sa.path);
      console.log(`  ${sa.agentId}: ${summary?.turns || 0} turns, ${summary?.toolCalls || 0} tools`);
    }
  }
}
