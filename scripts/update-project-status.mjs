#!/usr/bin/env node
/**
 * Scanează repo-ul HSMC și actualizează statusurile în PROJECT_STATUS.md.
 *
 * Reguli de detecție:
 *  ❌ MOCK     — fișier conține `Math.random`, `mockData`, `fakeData`, `lorem`, `TODO: mock`
 *  🟠 PARȚIAL  — conține `TODO`, `FIXME`, `placeholder`, `not implemented`
 *  🟡 EXTERN   — referă chei private, deploy mainnet, VPS, relayer, audit (cod gata, execuție externă)
 *  ✅ REAL     — restul (default pentru fișiere de cod care n-au flag-uri)
 *  🔵 INFRA    — config / docs (Cargo.toml, *.config.*, *.md, Dockerfile, Makefile, .env*, workflows)
 *  📦 GENERATED — src/integrations/supabase/{client,types}.ts, .env, package-lock, bun.lock*
 *
 * Output: rescrie tabelul de inventar în PROJECT_STATUS.md (între markerii AUTO-START/END)
 * și salvează un raport JSON în PROJECT_STATUS.report.json.
 *
 * Utilizare:
 *   node scripts/update-project-status.mjs           # actualizează în loc
 *   node scripts/update-project-status.mjs --check   # exit 1 dacă apar mock-uri (CI)
 */
import { readFileSync, writeFileSync, statSync, readdirSync } from "node:fs";
import { join, relative, extname } from "node:path";

const ROOT = process.cwd();
const IGNORE = new Set([
  "node_modules", ".git", "dist", "build", ".next", "target",
  ".cache", "coverage", ".turbo", ".vercel", ".lovable", "scripts",
]);
const GENERATED = new Set([
  "src/integrations/supabase/client.ts",
  "src/integrations/supabase/types.ts",
  ".env", "package-lock.json", "bun.lockb", "bun.lock",
]);
const INFRA_EXT = new Set([".toml", ".yml", ".yaml", ".json", ".md", ".lock", ".txt", ".cfg", ".ini"]);
const INFRA_NAMES = /^(Dockerfile|Makefile|\.env(\..+)?|.*\.config\.(ts|js|cjs|mjs)|tsconfig.*\.json|tailwind\.config\..*|postcss\.config\..*|eslint\.config\..*|vite\.config\..*|vitest\.config\..*|components\.json)$/;

const MOCK_PATTERNS = [
  /\bMath\.random\s*\(/,
  /\bmockData\b/,
  /\bfakeData\b/,
  /\blorem ipsum\b/i,
  /TODO[: ]?\s*mock/i,
  /\bfake[_-]?(price|balance|user|tx|transaction|block)\b/i,
];

// Strip line and block comments + string literals before scanning code,
// so things like `placeholder="John"` or `// Math.random() removed` don't trigger.
function stripCommentsAndStrings(src, ext) {
  let s = src;
  if ([".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".rs", ".sol", ".go", ".java", ".c", ".cpp", ".h"].includes(ext)) {
    s = s.replace(/\/\*[\s\S]*?\*\//g, " ");
    s = s.replace(/(^|[^:])\/\/[^\n]*/g, "$1");
    s = s.replace(/(["'`])(?:\\.|(?!\1)[^\\])*\1/g, '""');
  } else if ([".py", ".sh", ".rb"].includes(ext)) {
    s = s.replace(/(^|[^$])#[^\n]*/g, "$1");
  }
  return s;
}
const PARTIAL_PATTERNS = [/\bTODO\b/, /\bFIXME\b/, /\bnot implemented\b/i, /\bcoming soon\b/i];
const EXTERN_PATTERNS = [
  /private[_\s-]?key/i, /DEPLOYER_PRIVATE_KEY/, /mainnet.*deploy/i,
  /relayer/i, /VPS/i, /ofuck.*audit|audit.*required/i, /\$\d+k\b/,
];

function walk(dir, out = []) {
  for (const entry of readdirSync(dir)) {
    if (IGNORE.has(entry) || entry.startsWith(".git")) continue;
    const full = join(dir, entry);
    let st;
    try { st = statSync(full); } catch { continue; }
    if (st.isDirectory()) walk(full, out);
    else out.push(full);
  }
  return out;
}

function classify(absPath) {
  const rel = relative(ROOT, absPath).replaceAll("\\", "/");
  if (GENERATED.has(rel)) return { status: "📦", reason: "auto-generated" };
  const base = rel.split("/").pop();
  const ext = extname(rel);
  if (rel.startsWith("src/components/ui/")) return { status: "🔵", reason: "shadcn/ui" };
  if (INFRA_EXT.has(ext) || INFRA_NAMES.test(base)) {
    // .md/.toml etc still parsed for mock flags below if code, otherwise infra
    if ([".md", ".toml", ".yml", ".yaml", ".lock", ".txt"].includes(ext)) return { status: "🔵", reason: "config/docs" };
  }
  // Skip binary
  if ([".png", ".jpg", ".jpeg", ".gif", ".webp", ".ico", ".svg", ".woff", ".woff2", ".ttf", ".otf", ".pdf", ".lockb"].includes(ext)) {
    return { status: "🔵", reason: "asset" };
  }
  let content = "";
  try { content = readFileSync(absPath, "utf8"); } catch { return { status: "🔵", reason: "unreadable" }; }
  if (content.length === 0) return { status: "🟠", reason: "empty file" };

  const codeOnly = stripCommentsAndStrings(content, ext);

  for (const re of MOCK_PATTERNS) if (re.test(codeOnly)) return { status: "❌", reason: `mock pattern: ${re}` };
  for (const re of PARTIAL_PATTERNS) if (re.test(codeOnly)) return { status: "🟠", reason: `partial: ${re}` };
  for (const re of EXTERN_PATTERNS) if (re.test(codeOnly)) return { status: "🟡", reason: `external execution: ${re}` };

  if (INFRA_NAMES.test(base) || INFRA_EXT.has(ext)) return { status: "🔵", reason: "config" };
  return { status: "✅", reason: "real" };
}

function main() {
  const files = walk(ROOT).map(f => relative(ROOT, f).replaceAll("\\", "/")).sort();
  const report = files.map(rel => ({ path: rel, ...classify(join(ROOT, rel)) }));

  const counts = report.reduce((a, r) => (a[r.status] = (a[r.status] || 0) + 1, a), {});
  const mocks = report.filter(r => r.status === "❌");

  // Group by top-level dir
  const groups = {};
  for (const r of report) {
    const top = r.path.split("/")[0] || "(root)";
    (groups[top] ||= []).push(r);
  }

  let table = `<!-- AUTO-STATUS-START -->\n`;
  table += `> Generat automat: ${new Date().toISOString()} • rulează \`node scripts/update-project-status.mjs\`\n\n`;
  table += `**Sumar:** `;
  for (const [k, v] of Object.entries(counts)) table += `${k} ${v}  `;
  table += `\n\n`;

  for (const top of Object.keys(groups).sort()) {
    table += `### \`${top}/\`\n\n| Status | Fișier | Motiv |\n|---|---|---|\n`;
    for (const r of groups[top]) {
      table += `| ${r.status} | \`${r.path}\` | ${r.reason} |\n`;
    }
    table += `\n`;
  }
  table += `<!-- AUTO-STATUS-END -->\n`;

  const mdPath = join(ROOT, "PROJECT_STATUS.md");
  let md = "";
  try { md = readFileSync(mdPath, "utf8"); } catch {}
  if (md.includes("<!-- AUTO-STATUS-START -->")) {
    md = md.replace(/<!-- AUTO-STATUS-START -->[\s\S]*?<!-- AUTO-STATUS-END -->\n?/, table);
  } else {
    md += `\n\n---\n\n## 🔍 Auto-Inventar\n\n${table}`;
  }
  writeFileSync(mdPath, md);

  // Also write a copy in public/ so the app can serve it at /PROJECT_STATUS.md
  try { writeFileSync(join(ROOT, "public/PROJECT_STATUS.md"), md); } catch {}

  writeFileSync(join(ROOT, "PROJECT_STATUS.report.json"), JSON.stringify({ counts, mocks, report }, null, 2));

  console.log("✓ PROJECT_STATUS.md actualizat");
  console.log("  Files scanned:", report.length);
  console.log("  Counts:", counts);
  if (process.argv.includes("--check") && mocks.length > 0) {
    console.error("\n❌ Mock-uri detectate:");
    for (const m of mocks) console.error(" -", m.path, "→", m.reason);
    process.exit(1);
  }
}

main();
