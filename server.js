import { createServer } from "http";
import { Server } from "socket.io";
import fs from "fs";
import path from "path";
import os from "os";
import { findNewestSession, findSubagentLogs, parseSubagentSummary, parseLine, extractEvent } from "./src/parser.js";
import { getUsage, updateUsage, checkLogEntryForUsage } from "./src/usage-cache.js";
import { getCursorMetrics } from "./src/cursor-metrics.js";


const PORT = 3778;
const claudeDir = path.join(os.homedir(), ".claude");
const projectsDir = path.join(claudeDir, "projects");
const REPLAY_WINDOW_MS = 5 * 60 * 1000;
const LIVE_THRESHOLD_MS = 60 * 1000;

const agentIdMap = new Map();

const projectStates = new Map();

const socketActiveProject = new Map();

let planInfo = loadPlanInfo();

let globalActiveProjectId = null;

function createFreshMetrics() {
  return {
    tokens: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    cost: 0,
    turns: 0,
    toolCalls: 0,
    startTime: Date.now(),
    turnTimestamps: [],
    fileEdits: {},
    errors: [],
    modelTokens: {},
    recentResponses: [],
    totalCodeTokens: 0,
    costHistory: [],
    rateLimitHistory: [],
  };
}

function getOrCreateProjectState(projectId) {
  if (!projectStates.has(projectId)) {
    projectStates.set(projectId, {
      currentFile: null,
      fileOffset: 0,
      metrics: createFreshMetrics(),
      sessionInfo: null,
      activeSubagents: new Map(),
      subagentWatchers: new Map(),
      lineInfoCache: new Map(),
      lastKnownLines: new Map(),
    });
  }
  return projectStates.get(projectId);
}

function loadPlanInfo() {
  try {
    const creds = JSON.parse(fs.readFileSync(path.join(claudeDir, ".credentials.json"), "utf-8"));
    const oauth = creds.claudeAiOauth || {};
    return {
      subscriptionType: oauth.subscriptionType || "unknown",
      rateLimitTier: oauth.rateLimitTier || "unknown",
    };
  } catch {
    return { subscriptionType: "unknown", rateLimitTier: "unknown" };
  }
}

const httpServer = createServer((req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") {
    res.writeHead(200);
    res.end();
    return;
  }

  if (req.method === "GET" && req.url === "/projects") {
    const list = scanAllProjects();
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify(list));
    return;
  }

  if (req.method === "GET" && req.url?.startsWith("/scan-directory")) {
    const targetDir = path.resolve(".");
    const EXCLUDE = new Set(["node_modules", ".git", ".next", "dist", "build", ".cache", "out"]);

    function scanDir(dir, depth = 0) {
      if (depth > 5) return [];
      const entries = [];
      try {
        for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
          if (EXCLUDE.has(entry.name) || entry.name.startsWith(".")) continue;
          const fullPath = path.join(dir, entry.name);
          const relPath = path.relative(targetDir, fullPath).replace(/\\/g, "/");
          if (entry.isDirectory()) {
            const children = scanDir(fullPath, depth + 1);
            entries.push({ name: entry.name, path: relPath, type: "dir", children });
          } else {
            const ext = entry.name.split(".").pop() || "";
            let lines = 0;
            try { lines = fs.readFileSync(fullPath, "utf-8").split("\n").length; } catch {}
            entries.push({ name: entry.name, path: relPath, type: "file", ext, lines });
          }
        }
      } catch {}
      return entries;
    }

    const tree = scanDir(targetDir);
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ root: path.basename(targetDir), tree }));
    return;
  }

  if (req.method === "POST" && req.url === "/usage-update") {
    let body = "";
    req.on("data", chunk => body += chunk);
    req.on("end", () => {
      try {
        const data = JSON.parse(body);
        updateUsage({ ...data, source: data.source || "manual" });
        broadcastToProjectViewers(globalActiveProjectId);
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ ok: true }));
      } catch {
        res.writeHead(400);
        res.end("Invalid JSON");
      }
    });
    return;
  }
  res.writeHead(404);
  res.end();
});
const io = new Server(httpServer, {
  cors: { origin: ["http://localhost:3000", "http://localhost:3777", "http://127.0.0.1:3000", "http://127.0.0.1:3777"] },
});

function scanAllProjects() {
  if (!fs.existsSync(projectsDir)) return [];

  const projects = [];
  try {
    for (const dirName of fs.readdirSync(projectsDir)) {
      const dirPath = path.join(projectsDir, dirName);
      let stat;
      try { stat = fs.statSync(dirPath); } catch { continue; }
      if (!stat.isDirectory()) continue;

      let newestMtime = 0;
      let sessionCount = 0;
      let newestSessionPath = null;
      let newestSessionId = null;

      try {
        for (const file of fs.readdirSync(dirPath)) {
          if (!file.endsWith(".jsonl")) continue;
          sessionCount++;
          try {
            const fstat = fs.statSync(path.join(dirPath, file));
            if (fstat.mtimeMs > newestMtime) {
              newestMtime = fstat.mtimeMs;
              newestSessionPath = path.join(dirPath, file);
              newestSessionId = file.replace(".jsonl", "");
            }
          } catch {}
        }
      } catch {}

      if (sessionCount === 0) continue;

      const isLive = newestMtime > 0 && (Date.now() - newestMtime) < LIVE_THRESHOLD_MS;

      projects.push({
        id: dirName,
        name: dirName,
        lastActive: newestMtime > 0 ? new Date(newestMtime).toISOString() : null,
        lastActiveMtime: newestMtime,
        isLive,
        sessionCount,
        newestSessionPath,
        newestSessionId,
      });
    }
  } catch {}

  projects.sort((a, b) => b.lastActiveMtime - a.lastActiveMtime);
  return projects;
}

function findNewestSessionForProject(projectId) {
  const projPath = path.join(projectsDir, projectId);
  if (!fs.existsSync(projPath)) return null;

  let newest = null;
  let newestMtime = 0;

  try {
    for (const file of fs.readdirSync(projPath)) {
      if (!file.endsWith(".jsonl")) continue;
      const filePath = path.join(projPath, file);
      try {
        const stat = fs.statSync(filePath);
        if (stat.mtimeMs > newestMtime) {
          newestMtime = stat.mtimeMs;
          newest = { path: filePath, project: projectId, sessionId: file.replace(".jsonl", ""), mtime: stat.mtime };
        }
      } catch {}
    }
  } catch {}

  return newest;
}

function findStringInFile(filePath, searchStr, replaceAll = false) {
  if (!filePath || !searchStr) return [];
  try {
    const content = fs.readFileSync(filePath, "utf-8");
    const hunks = [];
    let searchFrom = 0;

    while (true) {
      const idx = content.indexOf(searchStr, searchFrom);
      if (idx === -1) break;
      const startLine = content.substring(0, idx).split("\n").length;
      const lineCount = searchStr.split("\n").length;
      hunks.push({ startLine, lineCount });
      if (!replaceAll) break;
      searchFrom = idx + searchStr.length;
    }
    return hunks;
  } catch {
    return [];
  }
}

function resolveEditLines(projectId, toolUseId, filePath, oldString, newString, replaceAll) {
  const projectState = getOrCreateProjectState(projectId);

  if (projectState.lineInfoCache.has(toolUseId)) return projectState.lineInfoCache.get(toolUseId);

  const oldLines = oldString ? oldString.split("\n").length : 0;
  const newLines = newString ? newString.split("\n").length : 0;
  const displayLines = Math.max(oldLines, newLines);

  let hunks = findStringInFile(filePath, oldString, replaceAll);

  if (hunks.length === 0 && newString) {
    hunks = findStringInFile(filePath, newString, replaceAll);
  }

  if (hunks.length === 0) {
    const short = shortPath(filePath);
    const lastLine = projectState.lastKnownLines.get(short);
    if (lastLine) {
      hunks = [{ startLine: lastLine, lineCount: displayLines }];
    }
  }

  if (hunks.length > 0) {
    const info = {
      hunks,
      startLine: hunks[0].startLine,
      endLine: hunks[0].startLine + displayLines - 1,
    };
    projectState.lineInfoCache.set(toolUseId, info);
    projectState.lastKnownLines.set(shortPath(filePath), hunks[0].startLine);
    return info;
  }

  return null;
}

function processEvent(projectId, event) {
  if (!event) return;
  const projectState = getOrCreateProjectState(projectId);

  if (event.type === "rateLimit") {
    projectState.metrics.rateLimitHistory.push({
      timestamp: new Date().toISOString(),
      status: event.status || "unknown",
      resetsAt: event.resetsAt || "",
    });
    if (projectState.metrics.rateLimitHistory.length > 50) projectState.metrics.rateLimitHistory.shift();
    emitToProjectViewers(projectId, "metrics", buildMetricsPayload(projectId));
    return;
  }

  if (event.role === "assistant") {
    if (event.tokens) {
      projectState.metrics.tokens.input += event.tokens.input;
      projectState.metrics.tokens.output += event.tokens.output;
      projectState.metrics.tokens.cacheRead += event.tokens.cacheRead;
      projectState.metrics.tokens.cacheWrite += event.tokens.cacheWrite;
    }
    if (event.costUSD) projectState.metrics.cost += event.costUSD;
    if (event.model) {
      const outTok = event.tokens?.output || 0;
      projectState.metrics.modelTokens[event.model] = (projectState.metrics.modelTokens[event.model] || 0) + outTok;
    }
    if (event.tokens?.output > 0) {
      projectState.metrics.recentResponses.push({ outputTokens: event.tokens.output, timestamp: event.timestamp || new Date().toISOString() });
      if (projectState.metrics.recentResponses.length > 5) projectState.metrics.recentResponses.shift();
    }
    if (event.tokens && event.costUSD) {
      projectState.metrics.costHistory.push({
        timestamp: event.timestamp || new Date().toISOString(),
        inputTokens: event.tokens.input,
        outputTokens: event.tokens.output,
        cacheRead: event.tokens.cacheRead,
        cacheWrite: event.tokens.cacheWrite,
        cost: event.costUSD,
        model: event.model || "",
      });
      if (projectState.metrics.costHistory.length > 200) projectState.metrics.costHistory.shift();
    }
    if (event.toolUses) {
      projectState.metrics.toolCalls += event.toolUses.length;
      for (const tu of event.toolUses) {
        if ((tu.tool === "Write" || tu.tool === "Edit") && tu.input?.file) {
          const short = shortPath(tu.input.file);
          projectState.metrics.fileEdits[short] = (projectState.metrics.fileEdits[short] || 0) + 1;
          projectState.metrics.totalCodeTokens += (event.tokens?.output || 0);
        }
        if (tu.tool === "Edit" && tu.input?.file) {
          const info = resolveEditLines(projectId, tu.id, tu.input.file, tu.input.oldString, tu.input.newString, tu.input.replaceAll);
          if (info) tu.lineInfo = info;
        }
        if (tu.tool === "Write") {
          const lines = (tu.input?.content || "").split("\n").length;
          tu.lineInfo = { startLine: 1, endLine: lines, hunks: [{ startLine: 1, lineCount: lines }] };
          try {
            tu.isNewFile = !fs.existsSync(tu.input?.file);
          } catch {
            tu.isNewFile = false;
          }
        }
        if (tu.isSubagent) {
          projectState.activeSubagents.set(tu.id, {
            type: tu.subagentType,
            desc: tu.subagentDesc,
            startTime: event.timestamp,
            background: tu.subagentBackground,
          });
          emitToProjectViewers(projectId, "subagent_start", { id: tu.id, ...projectState.activeSubagents.get(tu.id) });
        }
      }
    }
  }

  if (event.role === "user" && event.type === "user" && !event.isMeta) {
    const hasToolResults = event.toolResults && event.toolResults.length > 0;
    const hasUserText = event.text && event.text.trim().length > 0;
    if (hasUserText && !hasToolResults) {
      projectState.metrics.turns++;
      projectState.metrics.turnTimestamps.push(event.timestamp || new Date().toISOString());
    }
  }

  if (event.role === "user" && event.toolResults) {
    for (const tr of event.toolResults) {
      if (projectState.activeSubagents.has(tr.toolUseId)) {
        const sa = projectState.activeSubagents.get(tr.toolUseId);
        projectState.activeSubagents.delete(tr.toolUseId);
        emitToProjectViewers(projectId, "subagent_end", { id: tr.toolUseId, ...sa, result: tr.content, isError: tr.isError });
      }
      if (tr.isError) {
        const err = {
          id: `err-${Date.now()}-${tr.toolUseId}`,
          timestamp: event.timestamp,
          content: tr.content,
          toolUseId: tr.toolUseId,
        };
        projectState.metrics.errors.push(err);
        if (projectState.metrics.errors.length > 10) projectState.metrics.errors = projectState.metrics.errors.slice(-10);
        emitToProjectViewers(projectId, "error_pinned", err);
      }
    }
  }

  if (event.type === "system") {
    const parsed = checkLogEntryForUsage(event);
    if (parsed) {
      emitToProjectViewers(projectId, "usage_updated", getUsage());
    }
  }

  emitToProjectViewers(projectId, "event", event);
  emitToProjectViewers(projectId, "metrics", buildMetricsPayload(projectId));
}

function shortPath(filepath) {
  if (!filepath) return "";
  const parts = filepath.replace(/\\/g, "/").split("/");
  return parts.length > 2 ? parts.slice(-2).join("/") : filepath;
}

function calcVelocity(projectState) {
  const total = projectState.metrics.tokens.input + projectState.metrics.tokens.output;
  const elapsed = (Date.now() - projectState.metrics.startTime) / 1000;
  return elapsed > 0 ? Math.round(total / elapsed) : 0;
}

function calcHourlyTurns(projectState) {
  const oneHourAgo = Date.now() - 60 * 60 * 1000;
  return projectState.metrics.turnTimestamps.filter(ts => new Date(ts).getTime() > oneHourAgo).length;
}

function getTopFiles(projectState, n = 3) {
  return Object.entries(projectState.metrics.fileEdits)
    .sort((a, b) => b[1] - a[1]).slice(0, n)
    .map(([file, count]) => ({ file, count }));
}

function buildMetricsPayload(projectId) {
  const projectState = getOrCreateProjectState(projectId);
  const totalOut = projectState.metrics.tokens.output;
  const modelBreakdown = Object.entries(projectState.metrics.modelTokens).map(([model, tokens]) => ({
    model: model.replace("claude-", "").replace(/-\d{8}$/, ""),
    tokens,
    pct: totalOut > 0 ? Math.round((tokens / totalOut) * 100) : 0,
  }));

  const sessionElapsed = Date.now() - projectState.metrics.startTime;

  return {
    tokens: projectState.metrics.tokens,
    cost: projectState.metrics.cost,
    turns: projectState.metrics.turns,
    toolCalls: projectState.metrics.toolCalls,
    startTime: projectState.metrics.startTime,
    elapsed: sessionElapsed,
    velocity: calcVelocity(projectState),
    hourlyTurns: calcHourlyTurns(projectState),
    topFiles: getTopFiles(projectState, 3),
    errorCount: projectState.metrics.errors.length,
    activeSubagents: [...projectState.activeSubagents.entries()].map(([id, sa]) => ({ id, ...sa })),
    plan: planInfo,
    modelBreakdown,
    usage: getUsage(),
    rollingVelocity: calcRollingVelocity(projectState),
    efficiencyRatio: projectState.metrics.tokens.output > 0 ? Math.round((projectState.metrics.totalCodeTokens / projectState.metrics.tokens.output) * 100) : 0,
    costHistory: projectState.metrics.costHistory,
    rateLimitHistory: projectState.metrics.rateLimitHistory,
    cursorMetrics: getCursorMetrics(),
  };
}

function calcRollingVelocity(projectState) {
  const recent = projectState.metrics.recentResponses;
  if (recent.length < 2) return calcVelocity(projectState);
  const first = new Date(recent[0].timestamp).getTime();
  const last = new Date(recent[recent.length - 1].timestamp).getTime();
  const totalTok = recent.reduce((sum, r) => sum + r.outputTokens, 0);
  const elapsed = (last - first) / 1000;
  return elapsed > 0 ? Math.round(totalTok / elapsed) : 0;
}

function emitToProjectViewers(projectId, eventName, data) {
  for (const [socketId, activeProj] of socketActiveProject) {
    if (activeProj === projectId) {
      const s = io.sockets.sockets.get(socketId);
      if (s) s.emit(eventName, data);
    }
  }
}

function broadcastToProjectViewers(projectId) {
  if (!projectId) return;
  emitToProjectViewers(projectId, "metrics", buildMetricsPayload(projectId));
}

function readNewLines(projectId) {
  const projectState = getOrCreateProjectState(projectId);
  if (!projectState.currentFile) return;

  let stat;
  try { stat = fs.statSync(projectState.currentFile); } catch { return; }
  if (stat.size <= projectState.fileOffset) return;

  const fd = fs.openSync(projectState.currentFile, "r");
  const buf = Buffer.alloc(stat.size - projectState.fileOffset);
  fs.readSync(fd, buf, 0, buf.length, projectState.fileOffset);
  fs.closeSync(fd);
  projectState.fileOffset = stat.size;

  const newLines = buf.toString("utf-8").split("\n").filter(Boolean);
  for (const line of newLines) {
    const entry = parseLine(line);
    const event = extractEvent(entry);
    if (event) processEvent(projectId, event);
  }
}

function checkSubagentLogs(projectId) {
  const projectState = getOrCreateProjectState(projectId);
  if (!projectState.currentFile) return;
  const subagents = findSubagentLogs(projectState.currentFile);

  for (const sa of subagents) {
    if (!agentIdMap.has(sa.agentId)) {
      for (const [tuId] of projectState.activeSubagents) {
        if (!Array.from(agentIdMap.values()).includes(tuId)) {
          agentIdMap.set(sa.agentId, tuId);
          break;
        }
      }
    }
  }

  for (const sa of subagents) {
    if (!projectState.subagentWatchers.has(sa.agentId)) {
      projectState.subagentWatchers.set(sa.agentId, { path: sa.path, offset: 0 });
    }

    const watcher = projectState.subagentWatchers.get(sa.agentId);
    let stat;
    try { stat = fs.statSync(watcher.path); } catch { continue; }
    if (stat.size <= watcher.offset) continue;

    const fd = fs.openSync(watcher.path, "r");
    const buf = Buffer.alloc(stat.size - watcher.offset);
    fs.readSync(fd, buf, 0, buf.length, watcher.offset);
    fs.closeSync(fd);
    watcher.offset = stat.size;

    const lines = buf.toString("utf-8").split("\n").filter(Boolean);
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
  }
}

function checkProjectSession(projectId) {
  const session = findNewestSessionForProject(projectId);
  if (!session) return;

  const projectState = getOrCreateProjectState(projectId);

  if (projectState.currentFile !== session.path) {
    projectState.currentFile = session.path;
    projectState.fileOffset = 0;
    projectState.metrics = createFreshMetrics();
    projectState.activeSubagents.clear();
    projectState.subagentWatchers.clear();
    projectState.lineInfoCache.clear();
    projectState.lastKnownLines.clear();
    projectState.sessionInfo = {
      sessionId: session.sessionId,
      project: session.project,
      startedAt: new Date().toISOString(),
    };
    emitToProjectViewers(projectId, "session", projectState.sessionInfo);
  }

  readNewLines(projectId);
  checkSubagentLogs(projectId);
}

function checkAllProjects() {
  if (!fs.existsSync(projectsDir)) return;

  try {
    for (const dirName of fs.readdirSync(projectsDir)) {
      const dirPath = path.join(projectsDir, dirName);
      try {
        if (!fs.statSync(dirPath).isDirectory()) continue;
      } catch { continue; }

      const hasViewers = [...socketActiveProject.values()].includes(dirName);
      const projectState = projectStates.get(dirName);
      const recentlyActive = projectState?.currentFile && (() => {
        try { return (Date.now() - fs.statSync(projectState.currentFile).mtimeMs) < LIVE_THRESHOLD_MS; } catch { return false; }
      })();

      if (hasViewers || recentlyActive) {
        checkProjectSession(dirName);
      }
    }
  } catch {}

  const projects = scanAllProjects();
  if (projects.length > 0) {
    globalActiveProjectId = projects[0].id;
  }

  io.emit("projects_list", projects);
}

function resolveReplayLineNumbers(projectId, event) {
  if (event.role !== "assistant" || !event.toolUses) return;
  for (const tu of event.toolUses) {
    if (tu.tool === "Edit" && tu.input?.file && !tu.lineInfo) {
      const info = resolveEditLines(projectId, tu.id, tu.input.file, tu.input.oldString, tu.input.newString, tu.input.replaceAll);
      if (info) tu.lineInfo = info;
    }
    if (tu.tool === "Write" && !tu.lineInfo) {
      const lines = (tu.input?.content || "").split("\n").length;
      tu.lineInfo = { startLine: 1, endLine: lines, hunks: [{ startLine: 1, lineCount: lines }] };
    }
  }
}

function getReplayEvents(projectId) {
  const projectState = getOrCreateProjectState(projectId);
  if (!projectState.currentFile) return [];
  try {
    const raw = fs.readFileSync(projectState.currentFile, "utf-8");
    const lines = raw.trim().split("\n").filter(Boolean);
    const cutoff = Date.now() - REPLAY_WINDOW_MS;
    const replayEvents = [];

    for (const line of lines) {
      const entry = parseLine(line);
      const event = extractEvent(entry);
      if (!event) continue;
      if (event.timestamp && new Date(event.timestamp).getTime() < cutoff) continue;
      if (event.role === "assistant" || event.role === "user") {
        resolveReplayLineNumbers(projectId, event);
        replayEvents.push(event);
      }
    }

    if (replayEvents.length === 0) {
      const allEvents = [];
      for (const line of lines) {
        const entry = parseLine(line);
        const event = extractEvent(entry);
        if (event && (event.role === "assistant" || event.role === "user")) {
          resolveReplayLineNumbers(projectId, event);
          allEvents.push(event);
        }
      }
      return allEvents.slice(-20);
    }

    return replayEvents;
  } catch { return []; }
}

function sendProjectState(socket, projectId) {
  checkProjectSession(projectId);

  const projectState = getOrCreateProjectState(projectId);

  if (projectState.sessionInfo) socket.emit("session", projectState.sessionInfo);
  socket.emit("metrics", buildMetricsPayload(projectId));

  const replayEvents = getReplayEvents(projectId);
  if (replayEvents.length) socket.emit("history", replayEvents);

  if (projectState.metrics.errors.length) socket.emit("pinned_errors", projectState.metrics.errors);

  for (const [id, sa] of projectState.activeSubagents) {
    socket.emit("subagent_start", { id, ...sa });
  }
}

io.on("connection", (socket) => {
  console.log(`[modelscope] Client connected: ${socket.id}`);

  const initialProject = globalActiveProjectId;
  socketActiveProject.set(socket.id, initialProject);

  const projects = scanAllProjects();
  socket.emit("projects_list", projects);

  if (initialProject) {
    sendProjectState(socket, initialProject);
  }

  socket.on("switch_project", (projectId) => {
    console.log(`[modelscope] ${socket.id} switching to project: ${projectId}`);
    socketActiveProject.set(socket.id, projectId);

    socket.emit("session", null);
    socket.emit("history", []);
    socket.emit("pinned_errors", []);

    sendProjectState(socket, projectId);
  });

  socket.on("dismiss_error", (errorId) => {
    const activeProj = socketActiveProject.get(socket.id);
    if (activeProj) {
      const projectState = getOrCreateProjectState(activeProj);
      projectState.metrics.errors = projectState.metrics.errors.filter(e => e.id !== errorId);
      emitToProjectViewers(activeProj, "metrics", buildMetricsPayload(activeProj));
    }
  });

  socket.on("reset_stats", () => {
    const activeProj = socketActiveProject.get(socket.id);
    if (activeProj) {
      const projectState = getOrCreateProjectState(activeProj);
      projectState.metrics = createFreshMetrics();
      emitToProjectViewers(activeProj, "metrics", buildMetricsPayload(activeProj));
      console.log(`[modelscope] Stats reset for ${activeProj}`);
    }
  });

  socket.on("rate_limit", (data) => {
    const projectId = socketActiveProject.get(socket.id);
    if (!projectId) return;
    const projectState = getOrCreateProjectState(projectId);
    projectState.metrics.rateLimitHistory.push({
      timestamp: new Date().toISOString(),
      status: data.status || "unknown",
      resetsAt: data.resetsAt || "",
    });
    if (projectState.metrics.rateLimitHistory.length > 50) projectState.metrics.rateLimitHistory.shift();
    emitToProjectViewers(projectId, "metrics", buildMetricsPayload(projectId));
  });

  socket.on("disconnect", () => {
    console.log(`[modelscope] Client disconnected: ${socket.id}`);
    socketActiveProject.delete(socket.id);
  });
});

let projectListTimer = null;
function debouncedBroadcastProjectList() {
  if (projectListTimer) clearTimeout(projectListTimer);
  projectListTimer = setTimeout(() => {
    io.emit("projects_list", scanAllProjects());
    projectListTimer = null;
  }, 500);
}

async function startWatching() {
  const projects = scanAllProjects();
  if (projects.length > 0) {
    globalActiveProjectId = projects[0].id;
    checkProjectSession(globalActiveProjectId);
  }

  try {
    const chokidar = await import("chokidar");
    const watcher = chokidar.watch(projectsDir, {
      ignoreInitial: true, depth: 3,
      awaitWriteFinish: { stabilityThreshold: 100, pollInterval: 50 },
    });

    watcher.on("change", (p) => {
      if (!p.endsWith(".jsonl")) return;
      const rel = path.relative(projectsDir, p).replace(/\\/g, "/");
      const projectId = rel.split("/")[0];
      if (projectId) {
        checkProjectSession(projectId);
        globalActiveProjectId = projectId;
        debouncedBroadcastProjectList();
      }
    });

    watcher.on("add", (p) => {
      if (!p.endsWith(".jsonl")) return;
      const rel = path.relative(projectsDir, p).replace(/\\/g, "/");
      const projectId = rel.split("/")[0];
      if (projectId) {
        checkProjectSession(projectId);
        globalActiveProjectId = projectId;
        debouncedBroadcastProjectList();
      }
    });

    console.log(`[modelscope] Watching all projects with chokidar (depth: 3)`);
  } catch {
    console.log(`[modelscope] Polling all projects every 500ms`);
    setInterval(checkAllProjects, 2000);
  }
}

httpServer.listen(PORT, () => {
  console.log(`[modelscope] Socket.io server on http://localhost:${PORT}`);
  startWatching();
});
