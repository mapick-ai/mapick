// Shared state, paths, constants, and pure helpers for Mapick shell.
// No network or skill-specific logic — those live in sibling lib/ modules.

const fs = require("fs");
const path = require("path");
const os = require("os");
const { execSync } = require("child_process");

// __dirname is mapick/scripts/lib; CONFIG_DIR should be mapick/.
const CONFIG_DIR = path.dirname(path.dirname(__dirname));
const SCRIPTS_DIR = path.dirname(__dirname);
const CONFIG_FILE = path.join(CONFIG_DIR, "CONFIG.md");
const TRASH_DIR = path.join(CONFIG_DIR, "trash");
// redact.js lives next to shell.js (scripts/), NOT at CONFIG_DIR root.
// The CONFIG_DIR-based path silently no-op'd redact() — fs.existsSync
// returned false → early return — so `share` was uploading raw HTML
// with zero redaction. countRedactRules() already pointed at SCRIPTS_DIR;
// REDACTJS_PATH had drifted.
const REDACTJS_PATH = path.join(SCRIPTS_DIR, "redact.js");
const API_BASE = "https://api.mapick.ai/api/v1";
const CACHE_DIR = path.join(os.homedir(), ".mapick", "cache");

const OUT_ARR = parseInt(process.env.MAPICK_OUTPUT_ARRAY_LIMIT || "10", 10);
const OUT_STR = parseInt(process.env.MAPICK_OUTPUT_STRING_LIMIT || "4000", 10);
const SCAN_LIMIT = parseInt(process.env.MAPICK_SCAN_LIMIT || "50", 10);

const VALID_TRACK_ACTIONS = ["shown", "click", "install", "installed", "ignore", "not_interested"];
const VALID_EVENT_ACTIONS = ["skill_install", "skill_invoke", "skill_idle", "skill_uninstall", "rec_shown", "rec_click", "rec_ignore", "rec_installed", "sequence_pattern"];
const PROTECTED_SKILLS = ["mapick", "tasa"];
const REMOTE_COMMANDS = new Set(["recommend", "recommend:track", "search", "workflow", "daily", "weekly", "report", "security", "security:report", "clean", "clean:track", "share"]);

// Priority: env override → ~/.openclaw → ~/.claude → ~/.codex.
function detectSkillsBase() {
  const home = os.homedir();
  const candidates = [
    process.env.SKILLS_BASE,
    process.env.MAPICK_SKILLS_BASE,
    path.join(home, ".openclaw", "skills"),
    path.join(home, ".claude", "skills"),
    path.join(home, ".codex", "skills"),
  ].filter(Boolean);
  for (const dir of candidates) {
    if (fs.existsSync(dir)) return dir;
  }
  return candidates[0] || path.join(home, ".openclaw", "skills");
}
const SKILLS_BASE = detectSkillsBase();

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
    .filter((t) => t.length >= 2 && !STOPWORDS.has(t));
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

function hasConsent(config) {
  return Boolean(config.consent_version);
}

function isConsentDeclined(config) {
  return config.consent_declined === "true";
}

// Pipes text through scripts/redact.js. Used by http.js (audit-mode) and
// share command (true redaction of HTML). Returns original text on any
// failure — never throws — so a broken redact engine doesn't break Mapick.
function redact(text) {
  if (!text) return text;
  const config = readConfig();
  if (config.redact_disabled === "true") return text;
  if (!fs.existsSync(REDACTJS_PATH)) return text;
  try {
    const result = execSync(`node "${REDACTJS_PATH}"`, {
      input: text,
      encoding: "utf8",
      timeout: 5000,
    });
    return result.trim();
  } catch {
    return text;
  }
}

module.exports = {
  CONFIG_DIR, SCRIPTS_DIR, CONFIG_FILE, TRASH_DIR, REDACTJS_PATH, API_BASE, CACHE_DIR, SKILLS_BASE,
  OUT_ARR, OUT_STR, SCAN_LIMIT,
  VALID_TRACK_ACTIONS, VALID_EVENT_ACTIONS, PROTECTED_SKILLS, REMOTE_COMMANDS,
  stableHash16, isoNow, clampOutput, parseFrontmatter, extractProfileTags,
  readConfig, writeConfig, deleteConfig, readCache, writeCache, deviceFp,
  isProtected, hasConsent, isConsentDeclined, redact,
};
