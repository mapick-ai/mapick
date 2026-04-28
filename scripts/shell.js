#!/usr/bin/env node
/**
 * Mapick skill unified entry point (Node.js)
 * Usage: node shell.js <command> [args...]
 */

// Runtime preflight: bail with a structured error on Node < 22.14 (the
// OpenClaw runtime baseline; OpenClaw recommends 24) instead of letting V8
// emit an opaque SyntaxError when newer JS features are parsed.
// Exit 0 matches the rest of this file's contract (errors are JSON-on-stdout).
const [_NODE_MAJOR, _NODE_MINOR] = process.versions.node.split(".").map((n) => parseInt(n, 10));
if (
  !Number.isFinite(_NODE_MAJOR) ||
  _NODE_MAJOR < 22 ||
  (_NODE_MAJOR === 22 && _NODE_MINOR < 14)
) {
  console.log(JSON.stringify({
    error: "node_too_old",
    required: ">=22.14",
    got: process.version,
    hint: "Install Node.js 22.14 or later (OpenClaw runtime baseline) from https://nodejs.org",
  }));
  process.exit(0);
}

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const https = require("https");
const os = require("os");
const { execSync } = require("child_process");

const CONFIG_DIR = path.dirname(__dirname);
const CONFIG_FILE = path.join(CONFIG_DIR, "CONFIG.md");
const TRASH_DIR = path.join(CONFIG_DIR, "trash");
// redact.js lives next to this file (scripts/), NOT at CONFIG_DIR root.
// The previous CONFIG_DIR-based path silently no-op'd redact() on every call
// (existsSync returned false → early return), so `share` was uploading raw
// HTML with zero redaction applied. countRedactRules() already used a
// 2-candidate fallback that included this path; redact() never did.
const REDACTJS_PATH = path.join(__dirname, "redact.js");
const API_BASE = "https://api.mapick.ai/api/v1";
// Detect the skills install directory: openclaw / claude / codex live in different paths per platform.
// Priority: env override -> ~/.openclaw -> ~/.claude -> ~/.codex; falls back to .openclaw if none exist.
// Default candidate is created on first install.
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
const CACHE_DIR = path.join(os.homedir(), ".mapick", "cache");

const VALID_TRACK_ACTIONS = [
  "shown",
  "click",
  "install",
  "installed",
  "ignore",
  "not_interested",
];
const VALID_EVENT_ACTIONS = [
  "skill_install",
  "skill_invoke",
  "skill_idle",
  "skill_uninstall",
  "rec_shown",
  "rec_click",
  "rec_ignore",
  "rec_installed",
  "sequence_pattern",
];
const PROTECTED_SKILLS = ["mapick", "tasa"];
// REMOTE_COMMANDS removed in the opt-out pivot (#31). The skill no longer
// gates a fixed set of "remote" commands behind a consent check; instead,
// each command handles `declined` mode individually (refuse, anonymous
// fallback, or local heuristic — see DECLINED_REFUSE_COMMANDS below).

function deviceFp() {
  const config = readConfig();
  if (config.device_fp) return config.device_fp;
  const fp = crypto
    .createHash("sha256")
    .update(`${os.hostname()}|${os.platform()}|${os.homedir()}`)
    .digest("hex")
    .slice(0, 16);
  writeConfig("device_fp", fp);
  return fp;
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

function writeConfig(key, value) {
  const config = readConfig();
  config[key] = value;
  writeFullConfig(config);
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

// Backend HTTP client. Uses `curl` (system binary, already required in SKILL.md
// frontmatter) instead of Node's `https.request`.
//
// Why curl: Node 24 + macOS keychain interaction is flaky — `https.request`
// throws UNABLE_TO_VERIFY_LEAF_SIGNATURE for valid TLS endpoints because Node's
// bundled CA store doesn't include intermediate certs that the system keychain
// trusts. `--use-system-ca` is supposed to bridge this but doesn't reliably work
// on macOS in 24.x. curl uses the OS trust store directly and "just works",
// keeping mapick installs functional regardless of the user's Node version.
async function httpCall(method, endpoint, body = null) {
  const base = API_BASE.replace(/\/$/, "") + "/";
  const url = new URL(endpoint.replace(/^\//, ""), base);
  const STATUS_DELIM = "___MAPICK_HTTP_STATUS___";

  // Opt-out privacy model: send x-device-fp by default; suppress only when the
  // user has explicitly run `privacy decline`. Backend's anonymous endpoints
  // (e.g. /recommendations/feed without fp returns popularity) handle the no-fp
  // case; personalized commands fall back per-command in declined mode.
  const cfg = readConfig();
  const declined = cfg.consent_declined === "true";

  // -s silent, -S still show errors, -L follow redirects, -m timeout.
  // Append %{http_code} after a unique delimiter so we can split the body
  // from the status code without worrying about embedded newlines in JSON.
  const args = [
    "-sSL",
    "-X", method,
    "-m", "15",
    "-H", "Content-Type: application/json",
    ...(declined ? [] : ["-H", `x-device-fp: ${deviceFp()}`]),
    "-w", `\n${STATUS_DELIM}%{http_code}`,
    url.toString(),
  ];
  if (body) {
    args.push("-d", JSON.stringify(body));
  }

  return new Promise((resolve) => {
    const cp = require("child_process").execFile(
      "curl",
      args,
      { maxBuffer: 8 * 1024 * 1024 },
      (err, stdout) => {
        if (err && !stdout) {
          resolve({ error: "network_error", message: err.message });
          return;
        }
        const idx = stdout.lastIndexOf(STATUS_DELIM);
        const data = idx >= 0 ? stdout.slice(0, idx).replace(/\n$/, "") : stdout;
        const code = idx >= 0 ? parseInt(stdout.slice(idx + STATUS_DELIM.length).trim(), 10) : 0;

        if (!code || Number.isNaN(code)) {
          resolve({
            error: "network_error",
            message: err ? err.message : "no_status_code",
          });
        } else if (code >= 400) {
          // Pass through backend body for ALL 4xx/5xx, including 401/404/429.
          // Previously these three had fixed shapes that dropped the backend's
          // `message` / `hint` / `retryAfterSec` / etc. — so the AI saw a bare
          // "unauthorized" with no way to tell the user to run consent-agree
          // (regression of mapickii PR-21).
          const stableErrors = {
            401: "unauthorized",
            404: "not_found",
            429: "rate_limit",
          };
          const errCode = stableErrors[code] || "http_error";
          try {
            const parsed = JSON.parse(data);
            // backend body merged into result; statusCode authoritative.
            resolve({ error: errCode, statusCode: code, ...parsed });
          } catch {
            resolve({ error: errCode, statusCode: code, body: data });
          }
        } else {
          try {
            resolve(JSON.parse(data));
          } catch {
            resolve({ error: "parse_error", raw: data });
          }
        }
      },
    );
    // execFile doesn't pipe stdin by default; we passed body via -d already.
    cp.on("error", (e) =>
      resolve({ error: "network_error", message: e.message }),
    );
  });
}

// Lightweight frontmatter parser: reads the first ---...--- block as flat key:value (no nesting).
// Parses booleans and strips quotes; everything else stays as a string. Sufficient for simple fields like enabled/disabled.
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

function scanSkills() {
  const skills = [];
  if (!fs.existsSync(SKILLS_BASE)) return skills;
  const dirs = fs.readdirSync(SKILLS_BASE);
  dirs.forEach((dir) => {
    const skillPath = path.join(SKILLS_BASE, dir);
    const skillFile = path.join(skillPath, "SKILL.md");
    if (fs.statSync(skillPath).isDirectory() && fs.existsSync(skillFile)) {
      const content = fs.readFileSync(skillFile, "utf8");
      const fm = parseFrontmatter(content);
      skills.push({
        id: dir,
        name: typeof fm.name === "string" && fm.name ? fm.name : dir,
        path: skillPath,
        installed_at: fs.statSync(skillPath).birthtime.toISOString(),
        last_modified: fs.statSync(skillFile).mtime.toISOString(),
        // Enabled by default; only marked false when frontmatter explicitly sets disabled: true.
        enabled: fm.disabled !== true,
      });
    }
  });
  return skills;
}

function backupSkill(skillPath) {
  if (!fs.existsSync(TRASH_DIR)) fs.mkdirSync(TRASH_DIR, { recursive: true });
  const name = path.basename(skillPath);
  const backupPath = path.join(TRASH_DIR, `${name}_${Date.now()}`);
  fs.cpSync(skillPath, backupPath, { recursive: true });
  return backupPath;
}

function isProtected(skillId) {
  return PROTECTED_SKILLS.includes(skillId.toLowerCase());
}

function isoNow() {
  return new Date().toISOString();
}

// Counts rules in redact.js (used by the summary card's "X rules active" hint).
// Simple algorithm: scan the source for `[/` at the start of a line — one per RULES tuple. Auto-follows redact.js changes.
// Candidate paths:
//   - REDACTJS_PATH (CONFIG_DIR/redact.js): legacy path, may land at mapick/redact.js
//   - __dirname/redact.js: scripts/redact.js next to shell.js (the actual location)
function countRedactRules() {
  const candidates = [REDACTJS_PATH, path.join(__dirname, "redact.js")];
  for (const file of candidates) {
    if (!fs.existsSync(file)) continue;
    try {
      const content = fs.readFileSync(file, "utf8");
      const matches = content.match(/^\s*\[\//gm);
      if (matches && matches.length > 0) return matches.length;
    } catch {
      /* try next */
    }
  }
  return 0;
}

// Extract profile keywords: English words + whole CJK phrases. Drops stopwords, dedups, lowercases.
// Input "Backend, Go + K8s, reading logs" -> ["backend","go","k8s","reading","logs"].
// CJK input keeps the whole phrase between separators (no word segmentation).
function extractProfileTags(text) {
  if (!text) return [];
  const STOPWORDS = new Set([
    "and", "or", "the", "a", "an", "of", "in", "to", "for", "with", "i", "my",
    "is", "are", "do", "does", "doing", "use", "using", "uses",
    "和", "或", "的", "是", "在", "我", "你", "用", "做",
  ]);
  // Split on whitespace + punctuation (ASCII and CJK); CJK runs are preserved as single tokens.
  const tokens = text
    .toLowerCase()
    .split(/[\s,，.。、；;:!?！？()（）{}\[\]【】"'`+]+/u)
    .map((t) => t.trim())
    .filter((t) => t.length >= 2 && !STOPWORDS.has(t));
  return [...new Set(tokens)];
}

// Aggregate summary: local skills + optional backend status (top_used / security counts).
// When backend is unavailable (no consent or network failure), returns only the local part with has_backend=false.
async function aggregateSummary(skills, config) {
  const zombieDays = parseInt(process.env.MAPICK_ZOMBIE_DAYS || "30", 10);
  const now = Date.now();
  const ageDays = (s) =>
    (now - new Date(s.last_modified).getTime()) / 86_400_000;

  const total = skills.length;
  const zombies = skills.filter((s) => ageDays(s) > zombieDays);
  const active = skills.filter(
    (s) => s.enabled !== false && ageDays(s) <= zombieDays,
  ).length;
  const neverUsed = skills.filter(
    (s) => s.installed_at && s.last_modified === s.installed_at,
  ).length;
  // Rough context-cost estimate: ~2% per zombie, capped at 60% (V1 placeholder; replace with real ratio once backend is stable).
  const contextWastePct = Math.min(60, zombies.length * 2);

  const summary = {
    intent: "summary",
    privacy_rules: countRedactRules(),
    total,
    active,
    never_used: neverUsed,
    idle_30: zombies.length,
    activation_rate:
      total > 0 ? `${Math.round((active / total) * 100)}%` : "0%",
    zombie_count: zombies.length,
    context_waste_pct: contextWastePct,
    top_used: [],
    security: null,
    has_backend: false,
  };

  // Backend enrichment: top_used + security A/B/C counts. Skipped only when
  // the user has explicitly declined data sharing (opt-out model).
  if (isDeclined(config)) return summary;

  const fp = deviceFp();
  try {
    const status = await httpCall("GET", `/assistant/status/${fp}`);
    if (status && !status.error) {
      summary.has_backend = true;
      if (Array.isArray(status.top_used)) summary.top_used = status.top_used;
      if (status.security) summary.security = status.security;
    }
  } catch {
    /* graceful degrade — local data is still returned */
  }
  return summary;
}

// Opt-out privacy model: the only state that matters is "did the user
// explicitly decline?" There is no opt-in gate; personalized features are
// available by default and the user can decline at any time via
// `/mapick privacy decline`.
function isDeclined(config) {
  return config.consent_declined === "true";
}

// Personalized commands that have no meaningful anonymous fallback. In
// declined mode they refuse with a hint pointing at `privacy enable`.
// `recommend` is intentionally NOT in this set — it has an anonymous
// popularity fallback path (see recommend case).
const DECLINED_REFUSE_COMMANDS = new Set(["report", "share"]);

function declinedRefusal(command) {
  return {
    error: "declined",
    intent: command,
    hint: "This command needs personalization data (currently disabled). Run: /mapick privacy enable to re-enable.",
  };
}

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

// Register the daily-9am notify cron via OpenClaw. Idempotent — if a cron
// with the same name already exists, it's removed first so we don't accumulate
// duplicates across re-installs.  Failure is logged + swallowed; cron registration
// never blocks the consent-agree / init flow.
//
// Called in two places:
//   - consent-agree case (first-time registration after the user opts in)
//   - init case when already consented (safety net — re-registers if a user
//     manually deleted the cron, or if a previous install failed silently)
//
// Notes:
//   - Uses --session isolated because OpenClaw rejects --session main without
//     --system-event ("Main jobs require --system-event").
//   - No --channel/--to set: defers Telegram wiring to the user, who can run
//     `openclaw cron edit mapick-notify --channel telegram --to <chat-id>` later.
function registerNotifyCron() {
  try {
    execSync("command -v openclaw", { stdio: "ignore" });
  } catch {
    return { registered: false, reason: "openclaw_not_found" };
  }
  try {
    execSync("openclaw cron rm mapick-notify", { stdio: "ignore" });
  } catch {
    // No prior cron is fine — fall through and add it.
  }
  try {
    execSync(
      `openclaw cron add --name mapick-notify --cron "0 9 * * *" --session isolated --message "Run /mapick notify"`,
      { stdio: "ignore", timeout: 10000 },
    );
    return { registered: true };
  } catch (err) {
    return { registered: false, reason: err.message || "cron_add_failed" };
  }
}

const COMMAND = process.argv[2] || "status";
const ARGS = process.argv.slice(3);

async function main() {
  const config = readConfig();
  const fp = deviceFp();
  let result;

  // Opt-out privacy model: no consent gate here. Personalized commands handle
  // declined mode individually — `recommend` falls back to anonymous popularity,
  // `report`/`share` refuse with an opt-in hint, `clean` falls back to local
  // last-modified heuristic, etc. See per-case logic below.
  if (isDeclined(config) && DECLINED_REFUSE_COMMANDS.has(COMMAND)) {
    console.log(JSON.stringify(declinedRefusal(COMMAND)));
    return;
  }

  switch (COMMAND) {
    case "init":
    case "status":
      // Cooldown design (per #31):
      //   - last_init_success_at: written ONLY on completed init. Drives the
      //     30-min "we already greeted this session" idempotency window.
      //   - last_init_attempt_at: written before each attempt regardless of
      //     outcome. Rate-limits retry storms (30s minimum between attempts).
      //   - last_init_at: legacy field; read for backward compat with old
      //     installs but no longer written.
      //
      // Old bug being fixed: a coarse last_init_at written BEFORE doing
      // actual work meant any failure (network, scan error) locked the user
      // out of retry for 30 min and the skill looked dead.
      const lastSuccessTs = config.last_init_success_at
        ? new Date(config.last_init_success_at).getTime()
        : config.last_init_at
          ? new Date(config.last_init_at).getTime()
          : 0;
      const lastAttemptTs = config.last_init_attempt_at
        ? new Date(config.last_init_attempt_at).getTime()
        : 0;
      const successCooldown =
        parseInt(process.env.MAPICK_INIT_INTERVAL_MINUTES || "30") * 60000;
      const attemptCooldown = 30_000; // 30s retry-storm guard
      if (Date.now() - lastSuccessTs < successCooldown) {
        result = { status: "skip", reason: "cooldown" };
        break;
      }
      if (Date.now() - lastAttemptTs < attemptCooldown) {
        result = { status: "skip", reason: "retry_rate_limited" };
        break;
      }
      writeConfig("last_init_attempt_at", isoNow());
      const skills = scanSkills();
      if (!config.device_fp) {
        writeConfig("created_at", isoNow());
        result = {
          status: "first_install",
          data: {
            skillsCount: skills.length,
            skillNames: skills.slice(0, 5).map((s) => s.name),
          },
          // Inline privacy disclosure for the AI to render in the first-run
          // summary card (mandatory per #31). Opt-out model: data flows by
          // default, user can decline anytime.
          privacy: {
            mode: isDeclined(config) ? "declined" : "default",
            disclosure:
              "Mapick sends anonymous skill IDs + timestamps to api.mapick.ai. Sensitive content (API keys, paths, etc.) is filtered locally. Run /mapick privacy status for details, /mapick privacy decline to opt out.",
          },
        };
      } else {
        // Compute zombie / activation_rate / never_used for real, replacing the previous hardcoded 0/binary fallback.
        // Source is local mtime + frontmatter; the backend's invokeCount cron is a separate, more precise dataset.
        const zombieDays = parseInt(
          process.env.MAPICK_ZOMBIE_DAYS || "30",
          10,
        );
        const now = Date.now();
        const ageDays = (s) =>
          (now - new Date(s.last_modified).getTime()) / 86_400_000;

        const zombies = skills.filter((s) => ageDays(s) > zombieDays);
        const total = skills.length;
        // active = enabled AND not a zombie; excludes both explicitly disabled and long-untouched skills.
        const active = skills.filter(
          (s) => s.enabled && ageDays(s) <= zombieDays,
        ).length;

        result = {
          intent: "status",
          skills,
          activation_rate:
            total > 0 ? `${Math.round((active / total) * 100)}%` : "0%",
          zombie_count: zombies.length,
          // never_used is still approximated via last_modified (real invoke counts aren't available locally).
          never_used: skills.filter((s) => !s.last_modified).length,
        };

        // Safety net: re-register the notify cron on every successful init.
        // Recovers from cases where the user deleted the cron, the previous
        // attempt ran before openclaw was installed, or a fresh host needs
        // to inherit the schedule. registerNotifyCron is idempotent
        // (cron rm + cron add) so repeated calls are cheap. Skipped when
        // the user has explicitly declined data sharing.
        if (!isDeclined(config)) {
          registerNotifyCron();
        }
      }
      // Mark the attempt as successful (drives the 30-min idempotency window).
      writeConfig("last_init_success_at", isoNow());
      break;

    case "scan":
      const scannedSkills = scanSkills();
      result = { intent: "scan", skills: scannedSkills, scanned_at: isoNow() };
      break;

    case "recommend": {
      // --with-profile: append user_profile_tags from CONFIG.md to the query so the backend can boost results.
      const withProfile = ARGS.includes("--with-profile");
      const numericArgs = ARGS.filter((a) => !a.startsWith("--"));
      const limit = parseInt(numericArgs[0]) || 5;
      const declined = isDeclined(config);
      // Cache key differs for personalized vs anonymous so opt-out doesn't
      // serve a stale personalized response.
      const cacheKey = declined ? "recommend_anon" : `recommend_${fp}`;
      const cached = readCache(cacheKey);
      // An explicit limit or --with-profile always hits the backend, bypassing the 24h cache.
      const useCache = !withProfile && numericArgs.length === 0;
      if (useCache && cached) {
        result = {
          intent: "recommend",
          items: cached.items,
          cached: true,
          ...(declined ? { anonymous: true } : {}),
        };
        if (declined) {
          // Funnel cadence: show the opt-in funnel on first declined call after
          // each decline + every 5th call thereafter. Counter resets to 0 on
          // privacy enable.
          const count = parseInt(config.declined_recommend_count || "0", 10) + 1;
          writeConfig("declined_recommend_count", String(count));
          if (count === 1 || count % 5 === 0) {
            result.show_funnel = true;
          }
        }
      } else {
        let url = `/recommendations/feed?limit=${limit}`;
        if (!declined && withProfile) {
          // profileTags only makes sense when we're sending fp anyway.
          const tagsRaw = config.user_profile_tags || "";
          // CONFIG stores a JSON array string; on parse failure, fall back to comma-separated.
          let tags = [];
          try {
            tags = JSON.parse(tagsRaw);
          } catch {
            tags = tagsRaw.split(",").filter(Boolean);
          }
          if (tags.length > 0) {
            url += `&profileTags=${encodeURIComponent(tags.join(","))}`;
          }
          url += `&withProfile=1`;
        }
        const resp = await httpCall("GET", url);
        if (resp.error) result = resp;
        else {
          // Backend returns `anonymous: true` when no x-device-fp was sent
          // (per mapick-ai/mapick-api#20). The skill trusts that signal and
          // mirrors it; the AI uses it to switch rendering paths.
          const anon = Boolean(resp.anonymous) || declined;
          result = {
            intent: "recommend",
            items: resp.items || resp.recommendations || [],
            withProfile: declined ? false : withProfile,
            ...(anon ? { anonymous: true } : {}),
          };
          writeCache(cacheKey, { items: result.items });
          if (anon) {
            const count = parseInt(config.declined_recommend_count || "0", 10) + 1;
            writeConfig("declined_recommend_count", String(count));
            if (count === 1 || count % 5 === 0) {
              result.show_funnel = true;
            }
          }
        }
      }
      break;
    }

    case "recommend:track":
      if (ARGS.length < 3) {
        result = {
          error: "missing_argument",
          hint: "Usage: recommend:track <recId> <skillId> <action>",
        };
        break;
      }
      const [recId, skillId, action] = ARGS;
      if (!VALID_TRACK_ACTIONS.includes(action)) {
        result = { error: "invalid_action", valid: VALID_TRACK_ACTIONS };
        break;
      }
      result = await httpCall("POST", "/recommendations/track", {
        recId,
        skillId,
        action,
        userId: fp,
      });
      result.intent = "recommend:track";
      break;

    case "search":
      const query = ARGS[0] || "";
      const searchLimit = Math.min(parseInt(ARGS[1]) || 10, 20);
      if (!query.trim()) {
        result = { intent: "search", items: [], total: 0, query: "" };
        break;
      }
      const searchResp = await httpCall(
        "GET",
        `/skills/live-search?query=${encodeURIComponent(query)}&limit=${searchLimit}`,
      );
      if (searchResp.error) result = searchResp;
      else {
        const items = searchResp.results || searchResp.items || [];
        result = {
          intent: "search",
          items,
          total: items.length,
          query,
          ...(items.length < 5
            ? { notice: "Few local matches. Try ClawHub for more results." }
            : {}),
        };
      }
      break;

    case "clean": {
      // Declined mode: skip the backend (no fp = it can't compute personalized
      // zombies anyway) and fall back to a local last-modified heuristic.
      // Honest about the limitation in the response so the AI surfaces it.
      if (isDeclined(config)) {
        const zombieDays = parseInt(process.env.MAPICK_ZOMBIE_DAYS || "30", 10);
        const now = Date.now();
        const localSkills = scanSkills();
        const ageDays = (s) =>
          (now - new Date(s.last_modified).getTime()) / 86_400_000;
        const zombies = localSkills
          .filter((s) => ageDays(s) > zombieDays)
          .map((s) => ({
            skillId: s.id,
            name: s.name,
            last_modified: s.last_modified,
            days_idle: Math.round(ageDays(s)),
          }));
        result = {
          intent: "clean",
          zombies,
          local_heuristic: true,
          notice:
            "Personalized zombie detection requires data sharing (currently disabled). Showing local last-modified heuristic only — usage frequency isn't known. Run /mapick privacy enable for accurate detection.",
        };
        break;
      }
      const cleanResp = await httpCall("GET", `/users/${fp}/zombies`);
      // The previous shape `cleanResp.zombies || cleanResp || []` let backend
      // error objects ({error,statusCode}) leak through as the `zombies` array
      // because `error` is truthy. Pass errors through explicitly; otherwise
      // accept either a top-level array or `{zombies: [...]}` shape (the
      // endpoint has shipped both at different points — see mapickii history).
      if (cleanResp && cleanResp.error) {
        result = cleanResp;
      } else {
        result = {
          intent: "clean",
          zombies: Array.isArray(cleanResp) ? cleanResp : (cleanResp?.zombies || []),
        };
      }
      break;
    }

    // PR-26 → PR-27 simplified: single GET /notify/daily-check call. Backend
    // handles version comparison (cached GitHub fetch), zombies fetch, and
    // lastActiveAt bump in one shot. Output: { intent:"notify", alerts, checkedAt }.
    // Empty alerts ⇒ SKILL.md instructs the AI to stay silent ⇒ OpenClaw
    // delivers nothing.
    case "notify": {
      const versionFile = path.join(CONFIG_DIR, ".version");
      let installedVer = "";
      try {
        installedVer = fs.readFileSync(versionFile, "utf8").trim();
      } catch {}
      // Always send `repo` so the backend can fetch our own release stream
      // (the endpoint maintains a per-repo allowlist; mapick-ai/mapick is the
      // identifier for this Skill). Without it the backend returns alerts: [].
      const params = new URLSearchParams();
      if (installedVer) params.set("currentVersion", installedVer);
      params.set("repo", "mapick-ai/mapick");
      const resp = await httpCall("GET", `/notify/daily-check?${params}`);
      // Backend or network failure → silent empty alerts (silence-first).
      if (resp.error) {
        result = { intent: "notify", alerts: [] };
      } else {
        result = { intent: "notify", ...resp };
      }
      break;
    }

    case "clean:track":
      if (ARGS.length < 1) {
        result = {
          error: "missing_argument",
          hint: "Usage: clean:track <skillId>",
        };
        break;
      }
      result = await httpCall("POST", "/events/track", {
        userId: fp,
        skillId: ARGS[0],
        action: "skill_uninstall",
        metadata: { reason: "zombie_cleanup" },
      });
      result.intent = "clean:track";
      break;

    case "uninstall":
      if (ARGS.length < 1) {
        result = {
          error: "missing_argument",
          hint: "Usage: uninstall <skillId> [--confirm]",
        };
        break;
      }
      const targetId = ARGS[0];
      if (!ARGS.includes("--confirm")) {
        result = {
          error: "confirm_required",
          hint: "Add --confirm to execute",
        };
        break;
      }
      if (isProtected(targetId)) {
        result = { error: "protected_skill", skillId: targetId };
        break;
      }
      const skillDir = path.join(SKILLS_BASE, targetId);
      if (!fs.existsSync(skillDir)) {
        result = { error: "not_found", skillId: targetId };
        break;
      }
      const backup = backupSkill(skillDir);
      fs.rmSync(skillDir, { recursive: true, force: true });
      result = {
        intent: "uninstall",
        skillId: targetId,
        backup_path: backup,
        uninstalled_at: isoNow(),
      };
      break;

    case "workflow":
      result = await httpCall("GET", `/assistant/workflow/${fp}`);
      result.intent = "workflow";
      break;

    case "daily":
      result = await httpCall("GET", `/assistant/daily-digest/${fp}`);
      result.intent = "daily";
      break;

    case "weekly":
      result = await httpCall("GET", `/assistant/weekly/${fp}`);
      result.intent = "weekly";
      break;

    case "bundle":
      if (ARGS[0] === "recommend") {
        result = await httpCall("GET", "/bundle/recommend/list");
        result.intent = "bundle:recommend";
      } else if (ARGS[0] === "install" && ARGS[1]) {
        result = await httpCall("GET", `/bundle/${ARGS[1]}/install`);
        result.intent = "bundle:install";
        result.bundleId = ARGS[1];
      } else if (ARGS[0] === "track-installed" && ARGS[1]) {
        result = await httpCall("POST", "/bundle/seed", {
          bundleId: ARGS[1],
          userId: fp,
        });
        result.intent = "bundle:track-installed";
      } else if (ARGS[0]) {
        result = await httpCall("GET", `/bundle/${ARGS[0]}`);
        result.intent = "bundle:detail";
      } else {
        result = await httpCall("GET", "/bundle");
        result.intent = "bundle";
      }
      break;

    case "report":
      const reportResp = await httpCall("GET", `/report/persona`);
      result = { intent: "report", ...reportResp };
      if (
        result.status === "brewing" ||
        result.primaryPersona?.id === "fresh_meat"
      ) {
        result.status = result.status || "brewing";
        result.messageEn =
          result.messageEn ||
          ":lock: Your persona is brewing. Use Mapick for a few more skill actions before generating a shareable report.";
      }
      break;

    case "share":
      if (ARGS.length < 2) {
        result = {
          error: "missing_argument",
          hint: "Usage: share <reportId> <htmlFile>",
        };
        break;
      }
      const [reportId, htmlFile] = ARGS;
      if (!fs.existsSync(htmlFile)) {
        result = { error: "file_not_found", file: htmlFile };
        break;
      }
      const htmlContent = redact(fs.readFileSync(htmlFile, "utf8"));
      result = await httpCall("POST", "/share/upload", {
        reportId,
        html: htmlContent,
        locale: ARGS[2] || "en",
      });
      result.intent = "share";
      break;

    case "security":
      if (ARGS.length < 1) {
        result = {
          error: "missing_argument",
          hint: "Usage: security <skillId>",
        };
        break;
      }
      result = await httpCall("GET", `/skill/${ARGS[0]}/security`);
      result.intent = "security";
      break;

    case "security:report":
      if (ARGS.length < 3) {
        result = {
          error: "missing_argument",
          hint: "Usage: security:report <skillId> <reason> <evidence>",
        };
        break;
      }
      result = await httpCall("POST", `/skill/${ARGS[0]}/report`, {
        reason: ARGS[1],
        evidenceEn: ARGS[2],
      });
      result.intent = "security:report";
      break;

    case "privacy":
      const subCmd = ARGS[0] || "status";
      switch (subCmd) {
        case "status":
          // Opt-out model: there is no `consent_required` state. The skill is
          // either default-on (data sharing happens by default) or `declined`
          // (user explicitly opted out). Legacy `consent_version` may still be
          // present in CONFIG.md from pre-pivot installs — surfaced as
          // historical info but not used for any gating.
          result = {
            intent: "privacy:status",
            mode: config.consent_declined === "true" ? "declined" : "default",
            declined_at: config.consent_declined_at || null,
            // Legacy historical info — pre-pivot users may have these set;
            // they no longer affect behavior. AI may render as
            // "you previously agreed to v1.0; that record is historical."
            legacy_consent_version: config.consent_version || null,
            legacy_consent_agreed_at: config.consent_agreed_at || null,
            trusted_skills: config.trusted_skills
              ? config.trusted_skills.split(",")
              : [],
            redact_disabled: config.redact_disabled === "true",
            disclosure:
              "Mapick sends anonymous skill IDs + timestamps to api.mapick.ai. Sensitive content is filtered locally by scripts/redact.js before transmission. No PII, no chat content, no API keys.",
            commands: {
              decline: "/mapick privacy decline",
              enable: "/mapick privacy enable",
              delete_all: "/mapick privacy delete-all --confirm",
            },
          };
          break;

        case "trust":
          if (ARGS.length < 2) {
            result = {
              error: "missing_argument",
              hint: "Usage: privacy trust <skillId>",
            };
            break;
          }
          result = await httpCall("POST", "/users/trusted-skills", {
            userId: fp,
            skillId: ARGS[1],
            permission: "unredacted",
          });
          result.intent = "privacy:trust";
          const trusted = config.trusted_skills
            ? config.trusted_skills.split(",")
            : [];
          trusted.push(ARGS[1]);
          writeConfig("trusted_skills", trusted.join(","));
          break;

        case "untrust":
          if (ARGS.length < 2) {
            result = {
              error: "missing_argument",
              hint: "Usage: privacy untrust <skillId>",
            };
            break;
          }
          const untrusted = (
            config.trusted_skills ? config.trusted_skills.split(",") : []
          ).filter((s) => s !== ARGS[1]);
          writeConfig("trusted_skills", untrusted.join(","));
          result = { intent: "privacy:untrust", skillId: ARGS[1] };
          break;

        case "delete-all":
          if (!ARGS.includes("--confirm")) {
            result = {
              error: "confirm_required",
              destructive_scope:
                "local CONFIG.md + cache + trash + backend data (events, skill records, consents, trusted skills, recommendation feedback, share reports)",
            };
            break;
          }
          const deleteResp = await httpCall("DELETE", "/users/data");
          fs.rmSync(CONFIG_FILE, { force: true });
          fs.rmSync(CACHE_DIR, { recursive: true, force: true });
          fs.rmSync(TRASH_DIR, { recursive: true, force: true });
          const preservedFp = config.device_fp;
          fs.writeFileSync(
            CONFIG_FILE,
            `# Mapick Configuration\n# Auto-generated\n\ndevice_fp: ${preservedFp}\n`,
          );
          result = {
            intent: "privacy:delete-all",
            localCleared: true,
            backendResponse: deleteResp,
          };
          break;

        // `decline` is the canonical opt-out command. `consent-decline` is
        // accepted as a deprecated alias so older AI prompts / SKILL.md
        // references keep working through the transition.
        case "decline":
        case "consent-decline": {
          const declinedAt = isoNow();
          writeConfig("consent_declined", "true");
          writeConfig("consent_declined_at", declinedAt);
          // Reset the funnel counter so the next time the user runs recommend
          // they see the opt-in funnel on the very first call.
          deleteConfig("declined_recommend_count");
          // Best-effort backend notification so the server can stop further
          // processing for this fp. Failure is non-fatal — the local flag is
          // the source of truth and outgoing requests no longer carry fp.
          // After backend mapick-api#19 ships, this writes a UserConsent row
          // with declined=true, which ConsentGuard then enforces.
          let backendResp = null;
          try {
            backendResp = await httpCall("POST", "/users/consent", {
              declined: true,
              declinedAt,
            });
          } catch {
            backendResp = null;
          }
          result = {
            intent: "privacy:decline",
            mode: "declined",
            declinedAt,
            backend: backendResp && !backendResp.error ? "recorded" : "best_effort",
          };
          break;
        }

        // Symmetric opt-in: clears the decline flag. After this, x-device-fp
        // resumes flowing on outgoing requests and personalized commands work.
        // Resets the funnel counter so a future decline starts fresh.
        case "enable": {
          deleteConfig("consent_declined");
          deleteConfig("consent_declined_at");
          deleteConfig("declined_recommend_count");
          // Best-effort: tell backend to clear the decline record. Same
          // graceful failure model as decline above.
          let backendResp = null;
          try {
            backendResp = await httpCall("POST", "/users/consent", {
              declined: false,
            });
          } catch {
            backendResp = null;
          }
          // Re-register the notify cron now that we're back to default mode.
          const cronResult = registerNotifyCron();
          result = {
            intent: "privacy:enable",
            mode: "default",
            backend: backendResp && !backendResp.error ? "recorded" : "best_effort",
            notifyCron: cronResult,
          };
          break;
        }

        case "disable-redact":
          writeConfig("redact_disabled", "true");
          writeConfig("redact_disabled_at", isoNow());
          result = {
            intent: "privacy:disable-redact",
            status: "disabled",
            warning: "Sensitive data will be passed AS-IS",
          };
          break;

        case "enable-redact":
          deleteConfig("redact_disabled");
          deleteConfig("redact_disabled_at");
          result = { intent: "privacy:enable-redact", status: "enabled" };
          break;

        default:
          result = {
            error: "unknown_subcommand",
            hint: "Available: status | decline | enable | trust | untrust | delete-all | disable-redact | enable-redact",
          };
      }
      break;

    case "event":
    case "event:track":
      if (ARGS.length < 2) {
        result = {
          error: "missing_argument",
          hint: "Usage: event:track <userId> <action> [skillId]",
        };
        break;
      }
      const [userId, actionType, metaSkillId] = ARGS;
      if (!VALID_EVENT_ACTIONS.includes(actionType)) {
        result = { error: "invalid_action", valid: VALID_EVENT_ACTIONS };
        break;
      }
      result = await httpCall("POST", "/events/track", {
        userId,
        action: actionType,
        skillId: metaSkillId || null,
      });
      result.intent = "event:track";
      break;

    // First-install diagnostic card aggregation: local skills + (optional) backend top_used / security counts.
    case "summary": {
      const skills = scanSkills();
      result = await aggregateSummary(skills, config);
      break;
    }

    // User workflow self-description: profile set/get/clear. `set` also async-uploads extracted tags to the backend (when consent is given).
    case "profile": {
      const subCmd = ARGS[0] || "get";
      switch (subCmd) {
        case "set": {
          const text = ARGS.slice(1).join(" ").trim();
          if (!text) {
            result = {
              error: "missing_argument",
              hint: "Usage: profile set \"<workflow text>\"",
            };
            break;
          }
          const tags = extractProfileTags(text);
          writeConfig("user_profile", text);
          writeConfig("user_profile_tags", JSON.stringify(tags));
          writeConfig("user_profile_set_at", isoNow());
          // When consent is given, upload the profile so recommendations can boost; failures don't block local writes.
          // The backend endpoint is POST /users/:userId/profile-text, body contains only
          // profileText + profileTags (userId is in the path). Previously the path was wrongly
          // /users/profile and always 404'd — local writes succeeded but the backend never received
          // profileTags, so the --with-profile boost on recommend was always 0.
          // Opt-out model: upload the profile by default (data flows unless
          // user declined). The httpCall itself drops x-device-fp in declined
          // mode so the upload becomes useless when declined — short-circuit
          // here to skip the wasted request.
          let uploaded = false;
          if (!isDeclined(config)) {
            const resp = await httpCall("POST", `/users/${fp}/profile-text`, {
              profileText: text,
              profileTags: tags,
            });
            uploaded = !resp.error;
          }
          result = { intent: "profile:set", profile: text, tags, uploaded };
          break;
        }
        case "get": {
          let tags = [];
          try {
            tags = JSON.parse(config.user_profile_tags || "[]");
          } catch {
            tags = [];
          }
          result = {
            intent: "profile:get",
            profile: config.user_profile || null,
            tags,
            set_at: config.user_profile_set_at || null,
          };
          break;
        }
        case "clear": {
          deleteConfig("user_profile");
          deleteConfig("user_profile_tags");
          deleteConfig("user_profile_set_at");
          // Clearing the profile also clears first_run_complete so the next init re-triggers the first-run diagnostic card.
          deleteConfig("first_run_complete");
          deleteConfig("first_run_at");
          result = { intent: "profile:clear", cleared: true };
          break;
        }
        default:
          result = {
            error: "unknown_subcommand",
            hint: "Available: set | get | clear",
          };
      }
      break;
    }

    // Mark the first-run diagnostic flow as done (one-shot flag so we don't re-run the card on every startup).
    case "first-run-done":
      writeConfig("first_run_complete", "true");
      writeConfig("first_run_at", isoNow());
      result = { intent: "first-run-done", done: true };
      break;

    case "id":
      result = { intent: "id", debug_identifier: fp };
      break;

    case "help":
    case "--help":
    case "-h":
      console.error(`Mapick - Node.js version

Usage: node shell.js <command> [args...]

Commands:
  init / status           Skill status overview
  scan                    Force re-scan
  recommend [limit]       Personalized recommendations (cached 24h)
  recommend:track <recId> <skillId> <action>  Track feedback
  search <query> [limit]  Search skills
  clean                   Zombie skill list
  clean:track <skillId>   Record zombie cleanup
  uninstall <skillId> [--confirm]  Uninstall skill (backup to trash)
  workflow                Workflow analysis
  daily                   Daily digest
  weekly                  Weekly report
  bundle                  List bundles
  bundle <id>             Bundle details
  bundle:install <id>     Fetch install commands
  bundle:track-installed <id>  Record bundle install
  report                  Persona report
  share <reportId> <html> [locale]  Upload share page
  security <skillId>      Security score
  privacy status               Show privacy mode + trusted skills + disclosure
  privacy decline              Opt out of data sharing (resumes anonymous mode)
  privacy enable               Re-enable data sharing after a previous decline
  privacy trust <skillId>      Trust a skill (allow unredacted access)
  privacy untrust <skillId>    Revoke trust
  privacy delete-all --confirm GDPR erasure (local + backend data)
  event:track <userId> <action> [skillId]  Record event
  summary                 First-run diagnostic (local + optional backend)
  profile set "<text>"    Save user workflow self-description
  profile get             Read cached workflow profile
  profile clear           Reset profile + retrigger first-run summary
  first-run-done          Mark one-time first-run flag complete
  id                      Debug identifier (debug)`);
      result = { error: "usage" };
      break;

    default:
      result = {
        error: "unknown_command",
        command: COMMAND,
        hint: "Run help for usage",
      };
  }

  console.log(JSON.stringify(result));
}

main().catch((e) => console.log(JSON.stringify({ error: e.message })));
