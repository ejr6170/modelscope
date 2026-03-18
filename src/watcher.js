import fs from "fs";
import path from "path";
import os from "os";
import { findNewestSession, parseLine, extractEvent } from "./parser.js";

const claudeDir = path.join(os.homedir(), ".claude");
const POLL_INTERVAL = 500; // ms — fallback if chokidar unavailable

// ── State ───────────────────────────────────────────────────────
let currentFile = null;
let fileOffset = 0;
let sessionTokens = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };
let sessionCost = 0;
let turnCount = 0;
let startTime = Date.now();

// ── ANSI colors ─────────────────────────────────────────────────
const c = {
  reset: "\x1b[0m",
  dim: "\x1b[2m",
  bold: "\x1b[1m",
  cyan: "\x1b[36m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  magenta: "\x1b[35m",
  red: "\x1b[31m",
  blue: "\x1b[34m",
  bgBlack: "\x1b[40m",
  white: "\x1b[37m",
};

function clearAndHeader() {
  process.stdout.write("\x1b[2J\x1b[H");
  console.log(`${c.dim}${c.cyan}╔══════════════════════════════════════════════════════╗${c.reset}`);
  console.log(`${c.dim}${c.cyan}║${c.reset}  ${c.bold}${c.cyan}GHOST HUD${c.reset}  ${c.dim}— Live Session Observer${c.reset}               ${c.dim}${c.cyan}║${c.reset}`);
  console.log(`${c.dim}${c.cyan}╚══════════════════════════════════════════════════════╝${c.reset}`);
}

function printMetricsBar() {
  const elapsed = formatDuration(Date.now() - startTime);
  const total = sessionTokens.input + sessionTokens.output + sessionTokens.cacheRead;
  const velocity = total > 0 ? Math.round(total / ((Date.now() - startTime) / 1000)) : 0;

  console.log(`\n ${c.dim}${c.cyan}┌─ LIVE METRICS ────────────────────────────────────┐${c.reset}`);
  console.log(` ${c.dim}${c.cyan}│${c.reset}  ${c.yellow}Elapsed:${c.reset} ${elapsed}   ${c.yellow}Turns:${c.reset} ${turnCount}   ${c.yellow}Velocity:${c.reset} ${velocity} tok/s  ${c.dim}${c.cyan}│${c.reset}`);
  console.log(` ${c.dim}${c.cyan}│${c.reset}  ${c.green}In:${c.reset} ${sessionTokens.input}  ${c.magenta}Out:${c.reset} ${sessionTokens.output}  ${c.blue}Cache:${c.reset} ${sessionTokens.cacheRead}  ${c.red}Cost:${c.reset} $${sessionCost.toFixed(4)}  ${c.dim}${c.cyan}│${c.reset}`);
  console.log(` ${c.dim}${c.cyan}└───────────────────────────────────────────────────┘${c.reset}\n`);
}

function printEvent(event) {
  const time = event.timestamp ? new Date(event.timestamp).toLocaleTimeString() : "??:??:??";

  if (event.role === "assistant") {
    // Thinking
    if (event.thinking?.length) {
      const thought = event.thinking[0].slice(0, 120);
      if (thought) {
        console.log(` ${c.dim}${time}${c.reset} ${c.magenta}THINK${c.reset} ${c.dim}${thought}${c.reset}`);
      }
    }

    // Text response
    if (event.text?.length) {
      const text = event.text.join(" ").slice(0, 150);
      console.log(` ${c.dim}${time}${c.reset} ${c.green}REPLY${c.reset} ${text}`);
    }

    // Tool use
    if (event.toolUses?.length) {
      for (const tool of event.toolUses) {
        const input = tool.input ? JSON.stringify(tool.input).slice(0, 80) : "";
        console.log(` ${c.dim}${time}${c.reset} ${c.yellow}${tool.tool.padEnd(6)}${c.reset} ${c.dim}${input}${c.reset}`);
      }
    }

    // Update running totals
    if (event.tokens) {
      sessionTokens.input += event.tokens.input;
      sessionTokens.output += event.tokens.output;
      sessionTokens.cacheRead += event.tokens.cacheRead;
      sessionTokens.cacheWrite += event.tokens.cacheWrite;
    }
    if (event.costUSD) sessionCost += event.costUSD;
    if (event.text || event.thinking) turnCount++;
  }

  if (event.role === "user" && event.text && !event.text.includes("tool_result")) {
    const text = event.text.replace(/<[^>]+>/g, "").trim().slice(0, 120);
    if (text && !text.startsWith("[Request interrupted")) {
      console.log(` ${c.dim}${time}${c.reset} ${c.cyan}USER ${c.reset} ${text}`);
    }
  }
}

// ── Read new lines from the file ────────────────────────────────
function readNewLines(filePath) {
  const stat = fs.statSync(filePath);
  if (stat.size <= fileOffset) return;

  const fd = fs.openSync(filePath, "r");
  const buf = Buffer.alloc(stat.size - fileOffset);
  fs.readSync(fd, buf, 0, buf.length, fileOffset);
  fs.closeSync(fd);
  fileOffset = stat.size;

  const newLines = buf.toString("utf-8").split("\n").filter(Boolean);

  for (const line of newLines) {
    const entry = parseLine(line);
    const event = extractEvent(entry);
    if (event) printEvent(event);
  }
}

// ── Session discovery loop ──────────────────────────────────────
function discoverAndWatch() {
  const session = findNewestSession(claudeDir);
  if (!session) {
    console.log(`${c.dim}  Waiting for a Claude Code session...${c.reset}`);
    setTimeout(discoverAndWatch, 2000);
    return;
  }

  if (currentFile !== session.path) {
    currentFile = session.path;
    fileOffset = 0;
    sessionTokens = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };
    sessionCost = 0;
    turnCount = 0;
    startTime = Date.now();

    clearAndHeader();
    console.log(`\n ${c.dim}Watching:${c.reset} ${c.cyan}${session.project}${c.reset}`);
    console.log(` ${c.dim}Session:${c.reset}  ${session.sessionId}\n`);
    console.log(` ${c.dim}${c.cyan}─── Live Feed ──────────────────────────────────────${c.reset}\n`);
  }

  readNewLines(currentFile);
  printMetricsBar();
}

// ── Main: try chokidar, fall back to polling ────────────────────
async function main() {
  clearAndHeader();
  console.log(`\n ${c.dim}Scanning ${claudeDir}/projects for sessions...${c.reset}\n`);

  try {
    const chokidar = await import("chokidar");
    const projectsDir = path.join(claudeDir, "projects");

    // Initial load
    discoverAndWatch();

    // Watch for file changes
    const watcher = chokidar.watch(projectsDir, {
      ignoreInitial: true,
      depth: 2,
      awaitWriteFinish: { stabilityThreshold: 100, pollInterval: 50 },
    });

    watcher.on("change", (changedPath) => {
      if (!changedPath.endsWith(".jsonl")) return;

      // If a newer session appeared, switch to it
      const session = findNewestSession(claudeDir);
      if (session && session.path !== currentFile) {
        currentFile = null; // force rediscovery
      }

      discoverAndWatch();
    });

    watcher.on("add", () => discoverAndWatch());

    console.log(` ${c.dim}Using chokidar for file watching${c.reset}\n`);
  } catch {
    console.log(` ${c.dim}Chokidar not available — using polling (${POLL_INTERVAL}ms)${c.reset}\n`);
    discoverAndWatch();
    setInterval(discoverAndWatch, POLL_INTERVAL);
  }
}

function formatDuration(ms) {
  const s = Math.floor(ms / 1000);
  const m = Math.floor(s / 60);
  const h = Math.floor(m / 60);
  if (h > 0) return `${h}h ${m % 60}m`;
  if (m > 0) return `${m}m ${s % 60}s`;
  return `${s}s`;
}

main();
