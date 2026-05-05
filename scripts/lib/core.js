// Shared state, paths, constants, and pure helpers for Mapick shell.
// No network or skill-specific logic — those live in sibling lib/ modules.

const fs = require("fs");
const path = require("path");
const os = require("os");
const redactionEngine = require("../redact");

// __dirname is mapick/scripts/lib; CONFIG_DIR should be mapick/.
const CONFIG_DIR = path.dirname(path.dirname(__dirname));
const SCRIPTS_DIR = path.dirname(__dirname);
const CONFIG_FILE = path.join(CONFIG_DIR, "CONFIG.md");
const TRASH_DIR = path.join(CONFIG_DIR, "trash");
const REDACTJS_PATH = path.join(SCRIPTS_DIR, "redact.js");
// TEMP_LOCAL_API_FOR_TESTING 2026-04-30:
// Before publishing or pushing remote, restore this to
// "https://api.mapick.ai/api/v1".
const API_BASE = "http://127.0.0.1:3010/api/v1";
const CACHE_DIR = path.join(os.homedir(), ".mapick", "cache");

const OUT_ARR = parseInt(process.env.MAPICK_OUTPUT_ARRAY_LIMIT || "10", 10);
const OUT_STR = parseInt(process.env.MAPICK_OUTPUT_STRING_LIMIT || "4000", 10);
const SCAN_LIMIT = parseInt(process.env.MAPICK_SCAN_LIMIT || "50", 10);

const VALID_TRACK_ACTIONS = ["shown", "click", "install", "installed", "ignore", "not_interested"];
const VALID_EVENT_ACTIONS = ["skill_install", "skill_invoke", "skill_idle", "skill_uninstall", "rec_shown", "rec_click", "rec_ignore", "rec_installed", "sequence_pattern"];
const PROTECTED_SKILLS = ["mapick", "tasa"];
// `clean` is intentionally NOT here — handleClean falls back to a local
// last-modified heuristic when the user has declined data sharing or the
// backend is unreachable, so it works in all states.
const REMOTE_COMMANDS = new Set([
  "recommend", "recommend:track", "search", "intent",
  "workflow", "daily", "weekly", "notify", "report",
  "security", "security:report", "clean:track", "share",
  "bundle", "update:check", "update:track", "upgrade:plan",
]);

// Two skill roots OpenClaw loads from. Workspace is loaded BEFORE managed
// (so a workspace copy with the same id shadows the managed one).
const SKILLS_BASE = path.join(os.homedir(), ".openclaw", "skills");
const WORKSPACE_SKILLS_BASE = path.join(os.homedir(), ".openclaw", "workspace", "skills");
const SKILLS_BASES = [
  { path: SKILLS_BASE, source: "managed" },
  { path: WORKSPACE_SKILLS_BASE, source: "workspace" },
];

// Anonymous device fingerprint hash — not for auth.
function stableHash16(input) {
  let h1 = 0x811c9dc5 >>> 0;
  let h2 = 0x84222325 >>> 0;
  for (let i = 0; i < input.length; i++) {
    const c = input.charCodeAt(i);
    h1 = Math.imul((h1 ^ c) >>> 0, 0x01000193) >>> 0;
    h2 = Math.imul((h2 ^ c ^ (i + 1)) >>> 0, 0x01000193) >>> 0;
  }
  const hex = (n) => (n >>> 0).toString(16).padStart(8, "0");
  return hex(h1) + hex(h2);
}

function isoNow() {
  return new Date().toISOString();
}

// Output limiter: caps any array to OUT_ARR items and any string to OUT_STR
// chars. Prevents Mapick from dumping huge backend responses into the AI's
// context window.
function clampOutput(obj, depth = 0) {
  if (depth > 6) return "[deep]";
  if (Array.isArray(obj)) {
    const truncated = obj.length > OUT_ARR;
    const out = obj.slice(0, OUT_ARR).map((x) => clampOutput(x, depth + 1));
    if (truncated) out.push(`__truncated__${obj.length - OUT_ARR}_more__`);
    return out;
  }
  if (typeof obj === "string" && obj.length > OUT_STR) return obj.slice(0, OUT_STR) + "…";
  if (obj && typeof obj === "object") {
    const out = {};
    for (const [k, v] of Object.entries(obj)) out[k] = clampOutput(v, depth + 1);
    return out;
  }
  return obj;
}

function parseFrontmatter(content) {
  const m = content.match(/^---\s*\n([\s\S]*?)\n---/);
  if (!m) return {};
  const out = {};
  m[1].split("\n").forEach((line) => {
    const km = line.match(/^([a-z_][a-z0-9_]*)\s*:\s*(.+)$/i);
    if (!km) return;
    let v = km[2].trim();
    if (v === "true") v = true;
    else if (v === "false") v = false;
    else v = v.replace(/^["']|["']$/g, "");
    out[km[1]] = v;
  });
  return out;
}

// CJK runs are kept whole between separators (no word segmentation).
function extractProfileTags(text) {
  if (!text) return [];
  const STOPWORDS = new Set([
    "and", "or", "the", "a", "an", "of", "in", "to", "for", "with", "i", "my",
    "is", "are", "do", "does", "doing", "use", "using", "uses",
    "和", "或", "的", "是", "在", "我", "你", "用", "做",
  ]);
  const words = text
    .toLowerCase()
    .split(/[\s,，.。、；;:!?！？()（）{}\[\]【】"'`+]+/u)
    .map((t) => t.trim())
    .filter((t) => t.length >= 3 && !STOPWORDS.has(t));
  return [...new Set(words)];
}

function readConfig() {
  if (!fs.existsSync(CONFIG_FILE)) return {};
  const content = fs.readFileSync(CONFIG_FILE, "utf8");
  const config = {};
  content.split("\n").forEach((line) => {
    const match = line.match(/^(\w+):\s*(.+)$/);
    if (match) config[match[1]] = match[2];
  });
  return config;
}

function writeFullConfig(config) {
  const lines = [
    "# Mapick Configuration",
    "# Auto-generated - do not delete manually",
    "",
  ];
  Object.entries(config).forEach(([k, v]) => lines.push(`${k}: ${v}`));
  fs.writeFileSync(CONFIG_FILE, lines.join("\n"));
}

function writeConfig(key, value) {
  const config = readConfig();
  config[key] = value;
  writeFullConfig(config);
}

function deleteConfig(key) {
  const config = readConfig();
  delete config[key];
  writeFullConfig(config);
}

function readCache(key) {
  const cacheFile = path.join(CACHE_DIR, `${key}.json`);
  if (!fs.existsSync(cacheFile)) return null;
  try {
    const data = JSON.parse(fs.readFileSync(cacheFile, "utf8"));
    const age = Date.now() - new Date(data.cached_at).getTime();
    const ttl = data.ttl_hours ? data.ttl_hours * 3600000 : 86400000;
    if (age > ttl) return null;
    return data;
  } catch {
    return null;
  }
}

function writeCache(key, data, ttlHours = 24) {
  if (!fs.existsSync(CACHE_DIR)) fs.mkdirSync(CACHE_DIR, { recursive: true });
  data.cached_at = new Date().toISOString();
  data.ttl_hours = ttlHours;
  fs.writeFileSync(path.join(CACHE_DIR, `${key}.json`), JSON.stringify(data));
}

function deviceFp() {
  const config = readConfig();
  if (config.device_fp) return config.device_fp;
  const fp = stableHash16(`${os.hostname()}|${os.platform()}|${os.homedir()}`);
  writeConfig("device_fp", fp);
  return fp;
}

function isProtected(skillId) {
  return PROTECTED_SKILLS.includes(skillId.toLowerCase());
}

function isConsentDeclined(config) {
  return config.consent_declined === "true" || config.network_consent === "declined";
}

// Get proactive mode preference from config.
// Valid values: "helpful" (default), "silent", "off"
function getProactiveMode(config) {
  const mode = config.proactive_mode;
  if (mode === "silent" || mode === "off") return mode;
  return "helpful"; // default
}

// Validate skill IDs to prevent path traversal / injection.
// Only alphanumeric, underscore, hyphen; 1-64 chars.
const VALID_SKILL_ID_RE = /^[a-zA-Z0-9_.-]{1,64}$/;
function validateSkillId(id) {
  if (!id || typeof id !== "string") return false;
  return VALID_SKILL_ID_RE.test(id);
}

// Resolve installed Mapick version. OpenClaw 安装时会把版本写到
// `<install-dir>/.version`，但开发模式（直接从 git clone 跑）没有该文件，
// 此时 fallback 到 VERSION.md 的最新非 Unreleased 章节标题。
//
// 之前 misc.js / updates.js 都自己 readFileSync(.version)，没有 fallback，
// 导致 dev clone 下 /mapick notify 与 update:check 永远不报 mapick_self
// 更新。集中到这里一次性解决。
function readInstalledVersion() {
  const versionFile = path.join(CONFIG_DIR, ".version");
  try {
    const v = fs.readFileSync(versionFile, "utf8").trim();
    if (v) return v;
  } catch {}

  // Local development checkout: no installer-owned .version, but .git exists.
  // Treat it as a dev build so notify/update checks don't nag that the latest
  // published release is newer than the code currently being validated.
  try {
    const gitPath = path.join(CONFIG_DIR, ".git");
    let gitDir = gitPath;
    const gitStat = fs.statSync(gitPath);
    if (gitStat.isFile()) {
      const raw = fs.readFileSync(gitPath, "utf8").trim();
      const m = raw.match(/^gitdir:\s*(.+)$/);
      if (m) gitDir = path.resolve(CONFIG_DIR, m[1]);
    }
    const head = fs.readFileSync(path.join(gitDir, "HEAD"), "utf8").trim();
    if (/^[0-9a-f]{40}$/i.test(head)) return `local-${head.slice(0, 7)}`;
    const refMatch = head.match(/^ref:\s*(.+)$/);
    if (refMatch) {
      const refFile = path.join(gitDir, refMatch[1]);
      const sha = fs.readFileSync(refFile, "utf8").trim();
      if (/^[0-9a-f]{40}$/i.test(sha)) return `local-${sha.slice(0, 7)}`;
    }
  } catch {}

  // Fallback：解析 VERSION.md 第一个 `## vX.Y.Z` 标题（跳过 `## Unreleased`）。
  // VERSION.md 与 CONFIG_DIR 同级，是项目里唯一权威的版本时间线。
  const versionMd = path.join(CONFIG_DIR, "VERSION.md");
  try {
    const lines = fs.readFileSync(versionMd, "utf8").split("\n");
    for (const line of lines) {
      const m = line.match(/^##\s+(v\d+\.\d+\.\d+(?:-[\w.]+)?)\b/);
      if (m) return m[1];
    }
  } catch {}
  return null;
}

// Resolve a skill slug from various input formats.
// Handles: bare names, skillssh: URLs, clawhub: URLs, org/repo/name paths.
// Returns a clean slug suitable for `openclaw skills install`.
function resolveCanonicalSlug(raw) {
  if (!raw || typeof raw !== "string") return raw;
  const s = raw.trim();
  if (!s) return s;

  // 1. Pure short name (alphanumeric, underscore, hyphen) → return directly
  if (/^[a-zA-Z0-9_-]+$/.test(s)) return s;

  // 2. skillssh: prefix → extract last segment
  if (s.startsWith("skillssh:")) {
    const parts = s.split("/");
    return parts[parts.length - 1] || s;
  }

  // 3. clawhub: prefix → extract slug after the prefix
  if (s.startsWith("clawhub:")) {
    const rest = s.slice(8); // "clawhub:" length
    // clawhub:org/slug or clawhub:slug
    const parts = rest.split("/");
    return parts[parts.length - 1] || rest;
  }

  // 4. org/repo/name or org/name format → extract name
  const slashParts = s.split("/");
  if (slashParts.length >= 2) {
    return slashParts[slashParts.length - 1];
  }

  // 5. Fallback → return original
  return s;
}

function redactForUpload(text) {
  if (!text) return { ok: false, error: "empty_upload" };
  const config = readConfig();
  if (config.redact_disabled === "true") {
    return { ok: false, error: "redaction_disabled" };
  }
  try {
    const redacted = redactionEngine.redact(text).trim();
    if (!redacted) return { ok: false, error: "redaction_empty_result" };
    return { ok: true, text: redacted };
  } catch (err) {
    return { ok: false, error: "redaction_failed", message: err.message };
  }
}

module.exports = {
  CONFIG_DIR, SCRIPTS_DIR, CONFIG_FILE, TRASH_DIR, REDACTJS_PATH, API_BASE, CACHE_DIR,
  SKILLS_BASE, WORKSPACE_SKILLS_BASE, SKILLS_BASES,
  OUT_ARR, OUT_STR, SCAN_LIMIT,
  VALID_TRACK_ACTIONS, VALID_EVENT_ACTIONS, PROTECTED_SKILLS, REMOTE_COMMANDS,
  stableHash16, isoNow, clampOutput, parseFrontmatter, extractProfileTags,
  readConfig, writeConfig, deleteConfig, readCache, writeCache, deviceFp,
  isProtected, isConsentDeclined, getProactiveMode, validateSkillId, resolveCanonicalSlug,
  redactForUpload, readInstalledVersion,
};
