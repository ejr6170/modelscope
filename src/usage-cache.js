import fs from "fs";
import path from "path";
import os from "os";

const CACHE_FILE = path.join(os.homedir(), ".claude", "ghost-hud-usage.json");

const DEFAULT_USAGE = {
  sessionPercent: null,
  weeklyPercent: null,
  sonnetPercent: null,
  resetAt: null,
  resetLabel: null,
  lastUpdated: null,
  source: "none",
};

let currentUsage = loadCache();

function loadCache() {
  try {
    const data = JSON.parse(fs.readFileSync(CACHE_FILE, "utf-8"));
    return { ...DEFAULT_USAGE, ...data };
  } catch {
    return { ...DEFAULT_USAGE };
  }
}

function saveCache() {
  try {
    fs.writeFileSync(CACHE_FILE, JSON.stringify(currentUsage, null, 2));
  } catch {}
}

export function getUsage() {
  if (currentUsage.resetAt) {
    const resetMs = new Date(currentUsage.resetAt).getTime() - Date.now();
    if (resetMs > 0) {
      const hrs = Math.floor(resetMs / 3600000);
      const mins = Math.floor((resetMs % 3600000) / 60000);
      currentUsage.resetLabel = `Resets in ${hrs} hr ${mins} min`;
    } else {
      currentUsage.resetLabel = "Reset passed";
      currentUsage.sessionPercent = null;
      currentUsage.weeklyPercent = null;
    }
  }
  return { ...currentUsage };
}

export function updateUsage(data) {
  if (data.sessionPercent !== undefined) currentUsage.sessionPercent = data.sessionPercent;
  if (data.weeklyPercent !== undefined) currentUsage.weeklyPercent = data.weeklyPercent;
  if (data.sonnetPercent !== undefined) currentUsage.sonnetPercent = data.sonnetPercent;
  if (data.resetAt !== undefined) currentUsage.resetAt = data.resetAt;
  if (data.resetLabel !== undefined) currentUsage.resetLabel = data.resetLabel;
  currentUsage.lastUpdated = new Date().toISOString();
  currentUsage.source = data.source || "manual";
  saveCache();
}

export function parseUsageText(text) {
  const result = {};

  const sessionMatch = text.match(/(\d+)%\s*(?:of\s+)?session\s*(?:limit)?/i);
  if (sessionMatch) result.sessionPercent = parseInt(sessionMatch[1]);

  const weeklyMatch = text.match(/(\d+)%\s*(?:of\s+)?weekly\s*(?:limit)?/i);
  if (weeklyMatch) result.weeklyPercent = parseInt(weeklyMatch[1]);

  const sonnetMatch = text.match(/(\d+)%.*sonnet/i);
  if (sonnetMatch) result.sonnetPercent = parseInt(sonnetMatch[1]);

  const resetMatch = text.match(/[Rr]esets?\s+in\s+(\d+)\s*h(?:r|our)?\s*(\d+)\s*min/);
  if (resetMatch) {
    const hrs = parseInt(resetMatch[1]);
    const mins = parseInt(resetMatch[2]);
    result.resetAt = new Date(Date.now() + hrs * 3600000 + mins * 60000).toISOString();
    result.resetLabel = `Resets in ${hrs} hr ${mins} min`;
  }

  const resetMinMatch = text.match(/[Rr]esets?\s+in\s+(\d+)\s*min/);
  if (!resetMatch && resetMinMatch) {
    const mins = parseInt(resetMinMatch[1]);
    result.resetAt = new Date(Date.now() + mins * 60000).toISOString();
    result.resetLabel = `Resets in ${mins} min`;
  }

  if (Object.keys(result).length > 0) {
    result.source = "log-parse";
    updateUsage(result);
    return true;
  }
  return false;
}

export function checkLogEntryForUsage(entry) {
  if (!entry) return false;
  if (entry.type !== "system" || entry.subtype !== "local_command") return false;
  const content = entry.content || "";

  if (content.includes("command-name>/usage") || content.includes("session limit") || content.includes("weekly limit")) {
    const stdoutMatch = content.match(/<local-command-stdout>([\s\S]*?)<\/local-command-stdout>/);
    if (stdoutMatch) {
      return parseUsageText(stdoutMatch[1]);
    }
    return parseUsageText(content);
  }
  return false;
}
