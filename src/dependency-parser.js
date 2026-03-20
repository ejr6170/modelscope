import fs from "fs";
import path from "path";

const EXCLUDE = new Set(["node_modules", ".git", ".next", "dist", "build", ".cache", "out", "ModelScope-Build"]);
const PARSEABLE = new Set(["ts", "tsx", "js", "jsx", "mjs", "css"]);

const IMPORT_RE = /import\s+.*?\s+from\s+['"]([^'"]+)['"]/g;
const REQUIRE_RE = /require\(\s*['"]([^'"]+)['"]\s*\)/g;
const REEXPORT_RE = /export\s+.*?\s+from\s+['"]([^'"]+)['"]/g;
const DYNAMIC_RE = /import\(\s*['"]([^'"]+)['"]\s*\)/g;
const CSS_IMPORT_RE = /@import\s+(?:url\(\s*)?['"]?([^'")\s;]+)['"]?\s*\)?/g;

const EXT_CHAIN = ["", ".ts", ".tsx", ".js", ".jsx", "/index.ts", "/index.tsx", "/index.js", "/index.jsx"];

function resolveImport(specifier, fromFile, rootDir) {
  if (!specifier.startsWith("./") && !specifier.startsWith("../")) return null;
  const fromDir = path.dirname(fromFile);
  const base = path.resolve(rootDir, fromDir, specifier);
  for (const ext of EXT_CHAIN) {
    const candidate = base + ext;
    try {
      if (fs.statSync(candidate).isFile()) {
        return path.relative(rootDir, candidate).replace(/\\/g, "/");
      }
    } catch {}
  }
  return null;
}

function extractImports(content, ext) {
  const results = [];
  const patterns = ext === "css"
    ? [{ re: CSS_IMPORT_RE, type: "css-import" }]
    : [
        { re: IMPORT_RE, type: "import" },
        { re: REQUIRE_RE, type: "require" },
        { re: REEXPORT_RE, type: "re-export" },
        { re: DYNAMIC_RE, type: "import" },
      ];

  for (const { re, type } of patterns) {
    re.lastIndex = 0;
    let match;
    while ((match = re.exec(content)) !== null) {
      results.push({ specifier: match[1], edgeType: type });
    }
  }
  return results;
}

function walkDir(dir, rootDir, depth = 0) {
  if (depth > 5) return [];
  const entries = [];
  try {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (EXCLUDE.has(entry.name) || entry.name.startsWith(".")) continue;
      const fullPath = path.join(dir, entry.name);
      const relPath = path.relative(rootDir, fullPath).replace(/\\/g, "/");
      if (entry.isDirectory()) {
        const children = walkDir(fullPath, rootDir, depth + 1);
        entries.push({ path: relPath, name: entry.name, type: "dir", children });
      } else {
        const ext = entry.name.split(".").pop() || "";
        let lines = 0;
        try { lines = fs.readFileSync(fullPath, "utf-8").split("\n").length; } catch {}
        entries.push({ path: relPath, name: entry.name, type: "file", ext, lines });
      }
    }
  } catch {}
  return entries;
}

function flattenEntries(entries, parentDir = "") {
  const nodes = [];
  for (const e of entries) {
    nodes.push({ id: e.path, name: e.name, path: e.path, type: e.type, ext: e.ext || "", lines: e.lines || 0, parentDir });
    if (e.type === "dir" && e.children) {
      nodes.push(...flattenEntries(e.children, e.path));
    }
  }
  return nodes;
}

export function parseDependencies(rootDir) {
  const tree = walkDir(rootDir, rootDir);
  const nodes = flattenEntries(tree);
  const edges = [];

  for (const node of nodes) {
    if (node.type !== "file" || !PARSEABLE.has(node.ext)) continue;
    const fullPath = path.join(rootDir, node.path);
    let content;
    try { content = fs.readFileSync(fullPath, "utf-8"); } catch { continue; }

    const imports = extractImports(content, node.ext);
    for (const { specifier, edgeType } of imports) {
      const resolved = resolveImport(specifier, node.path, rootDir);
      if (resolved && nodes.some(n => n.id === resolved)) {
        edges.push({ from: node.id, to: resolved, edgeType });
      }
    }
  }

  return { nodes, edges };
}
