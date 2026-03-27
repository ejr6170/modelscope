import Database from "better-sqlite3";
import path from "path";
import os from "os";

let cache = { data: null, cachedAt: 0 };
const CACHE_TTL = 30000;

const DB_PATH = path.join(os.homedir(), ".cursor", "ai-tracking", "ai-code-tracking.db");

export function getCursorMetrics() {
  if (cache.data && Date.now() - cache.cachedAt < CACHE_TTL) return cache.data;

  let db;
  try {
    db = new Database(DB_PATH, { readonly: true, fileMustExist: true });
  } catch {
    return null;
  }

  try {
    const totalHashes = db.prepare("SELECT COUNT(*) as c FROM ai_code_hashes").get().c;
    const composerHashes = db.prepare("SELECT COUNT(*) as c FROM ai_code_hashes WHERE source = 'composer'").get().c;
    const humanHashes = db.prepare("SELECT COUNT(*) as c FROM ai_code_hashes WHERE source = 'human'").get().c;

    const commitRow = db.prepare("SELECT AVG(CAST(v2AiPercentage AS REAL)) as avg FROM scored_commits").get();
    const aiPercentage = commitRow?.avg != null ? Math.round(commitRow.avg * 10) / 10 : (totalHashes > 0 ? Math.round((composerHashes / totalHashes) * 1000) / 10 : 0);

    const modelRow = db.prepare("SELECT model FROM ai_code_hashes ORDER BY createdAt DESC LIMIT 1").get();
    const activeModel = modelRow?.model || "unknown";

    let trackingSince = null;
    const tsRow = db.prepare("SELECT value FROM tracking_state WHERE key = 'trackingStartTime'").get();
    if (tsRow?.value) {
      try {
        const parsed = JSON.parse(tsRow.value);
        trackingSince = new Date(parsed.timestamp).toISOString();
      } catch { trackingSince = null; }
    }

    const dailyRows = db.prepare(`
      SELECT DATE(createdAt / 1000, 'unixepoch') as date,
        SUM(CASE WHEN source = 'composer' THEN 1 ELSE 0 END) as composer,
        SUM(CASE WHEN source != 'composer' THEN 1 ELSE 0 END) as human
      FROM ai_code_hashes
      WHERE createdAt > (strftime('%s', 'now') - 30 * 86400) * 1000
      GROUP BY date ORDER BY date
    `).all();
    const dailyActivity = dailyRows.map(r => ({ date: r.date, composer: r.composer, human: r.human }));

    const topRows = db.prepare(`
      SELECT fileName, fileExtension, COUNT(*) as count
      FROM ai_code_hashes
      WHERE source = 'composer'
      GROUP BY fileName ORDER BY count DESC LIMIT 15
    `).all();
    const topFiles = topRows.map(r => ({ fileName: r.fileName, fileExtension: r.fileExtension || "", count: r.count }));

    const commitRows = db.prepare(`
      SELECT commitHash, commitMessage, commitDate, linesAdded, linesDeleted,
        composerLinesAdded, humanLinesAdded, v2AiPercentage
      FROM scored_commits ORDER BY commitDate DESC LIMIT 20
    `).all();
    const commits = commitRows.map(r => ({
      commitHash: r.commitHash,
      commitMessage: r.commitMessage || "",
      commitDate: r.commitDate || "",
      linesAdded: r.linesAdded || 0,
      linesDeleted: r.linesDeleted || 0,
      composerLinesAdded: r.composerLinesAdded || 0,
      humanLinesAdded: r.humanLinesAdded || 0,
      aiPercentage: parseFloat(r.v2AiPercentage) || 0,
    }));

    const result = { totalHashes, composerHashes, humanHashes, aiPercentage, activeModel, trackingSince, dailyActivity, topFiles, commits };
    cache = { data: result, cachedAt: Date.now() };
    return result;
  } catch {
    return null;
  } finally {
    db.close();
  }
}
