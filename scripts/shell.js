#!/usr/bin/env node
/**
 * Mapick skill unified entry point (Node.js)
 * Usage: node shell.js <command> [args...]
 */

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const https = require("https");
const os = require("os");
const { execSync } = require("child_process");

const CONFIG_DIR = path.dirname(__dirname);
const CONFIG_FILE = path.join(CONFIG_DIR, "CONFIG.md");
const TRASH_DIR = path.join(CONFIG_DIR, "trash");
const REDACTJS_PATH = path.join(CONFIG_DIR, "redact.js");
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
const REMOTE_COMMANDS = new Set([
  "recommend",
  "recommend:track",
  "search",
  "workflow",
  "daily",
  "weekly",
  "report",
  "security",
  "security:report",
  "clean",
  "clean:track",
  "share",
]);

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

async function httpCall(method, endpoint, body = null) {
  const base = API_BASE.replace(/\/$/, "") + "/";
  const url = new URL(endpoint.replace(/^\//, ""), base);
  const isHttps = url.protocol === "https:";
  const httpModule = isHttps ? https : require("http");
  const options = {
    hostname: url.hostname,
    port: url.port || (isHttps ? 443 : 80),
    path: url.pathname + url.search,
    method,
    headers: {
      "Content-Type": "application/json",
      "x-device-fp": deviceFp(),
    },
  };

  return new Promise((resolve, reject) => {
    const req = httpModule.request(options, (res) => {
      let data = "";
      res.on("data", (chunk) => (data += chunk));
      res.on("end", () => {
        if (res.statusCode === 401)
          resolve({ error: "unauthorized", statusCode: 401 });
        else if (res.statusCode === 404)
          resolve({ error: "not_found", statusCode: 404 });
        else if (res.statusCode === 429)
          resolve({ error: "rate_limit", statusCode: 429 });
        else if (res.statusCode >= 400)
          resolve({
            error: "http_error",
            statusCode: res.statusCode,
            body: data,
          });
        else {
          try {
            resolve(JSON.parse(data));
          } catch {
            resolve({ error: "parse_error", raw: data });
          }
        }
      });
    });
    req.on("error", (e) =>
      resolve({ error: "network_error", message: e.message }),
    );
    if (body) req.write(JSON.stringify(body));
    req.end();
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

  // Backend enrichment: top_used + security A/B/C counts. Skipped entirely without consent.
  if (!hasConsent(config) || isConsentDeclined(config)) return summary;

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

function isConsentDeclined(config) {
  return config.consent_declined === "true";
}

function hasConsent(config) {
  return Boolean(config.consent_version);
}

function isRemoteCommand(command, args) {
  if (REMOTE_COMMANDS.has(command)) return true;
  if (command === "bundle") return true;
  if (command === "privacy" && ["trust"].includes(args[0])) return true;
  return false;
}

function remoteAccessError(config) {
  if (isConsentDeclined(config)) {
    return {
      error: "disabled_in_local_mode",
      mode: "local_only",
      hint: "This command requires consent. Run: privacy consent-agree 1.0",
    };
  }

  return {
    error: "consent_required",
    hint: "This command requires consent. Run: privacy consent-agree 1.0",
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

const COMMAND = process.argv[2] || "status";
const ARGS = process.argv.slice(3);

async function main() {
  const config = readConfig();
  const fp = deviceFp();
  let result;

  if (isRemoteCommand(COMMAND, ARGS) && (!hasConsent(config) || isConsentDeclined(config))) {
    console.log(JSON.stringify(remoteAccessError(config)));
    return;
  }

  switch (COMMAND) {
    case "init":
    case "status":
      const lastInit = config.last_init_at
        ? new Date(config.last_init_at).getTime()
        : 0;
      const cooldown =
        parseInt(process.env.MAPICK_INIT_INTERVAL_MINUTES || "30") * 60000;
      if (Date.now() - lastInit < cooldown) {
        result = { status: "skip", reason: "cooldown" };
        break;
      }
      writeConfig("last_init_at", isoNow());
      const skills = scanSkills();
      if (!config.device_fp) {
        writeConfig("created_at", isoNow());
        result = {
          status: "first_install",
          data: {
            skillsCount: skills.length,
            skillNames: skills.slice(0, 5).map((s) => s.name),
          },
          privacy: "Anonymous by design. No registration.",
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
      }
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
      const cacheKey = `recommend_${fp}`;
      const cached = readCache(cacheKey);
      // An explicit limit or --with-profile always hits the backend, bypassing the 24h cache.
      const useCache = !withProfile && numericArgs.length === 0;
      if (useCache && cached) {
        result = { intent: "recommend", items: cached.items, cached: true };
      } else {
        let url = `/recommendations/feed?limit=${limit}`;
        if (withProfile) {
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
          result = {
            intent: "recommend",
            items: resp.items || resp.recommendations || [],
            withProfile,
          };
          writeCache(cacheKey, { items: result.items });
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

    case "clean":
      const cleanResp = await httpCall("GET", `/users/${fp}/zombies`);
      result = {
        intent: "clean",
        zombies: cleanResp.zombies || cleanResp || [],
      };
      break;

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
      const qs = installedVer
        ? `?currentVersion=${encodeURIComponent(installedVer)}`
        : "";
      const resp = await httpCall("GET", `/notify/daily-check${qs}`);
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
          result = {
            intent: "privacy:status",
            consent_version: config.consent_version || null,
            consent_agreed_at: config.consent_agreed_at || null,
            consent_declined: config.consent_declined === "true",
            remote_access:
              config.consent_declined === "true"
                ? "local_only"
                : config.consent_version
                  ? "enabled"
                  : "consent_required",
            trusted_skills: config.trusted_skills
              ? config.trusted_skills.split(",")
              : [],
            redact_disabled: config.redact_disabled === "true",
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

        case "consent-agree": {
          // PR-21: previously the httpCall return value was discarded — when the POST failed, CONFIG
          // was still written as "agreed". Result: no row in user_consents, and later ConsentGuard
          // calls still 403'd. Now we only write local state on a successful POST; on failure we
          // surface the backend error so the AI can report reality instead of falsely showing "agreed".
          const version = ARGS[1] || "1.0";
          const now = isoNow();
          const resp = await httpCall("POST", "/users/consent", {
            consentVersion: version,
            agreedAt: now,
          });
          if (resp && resp.error) {
            // Skip the local write — keep the "not agreed" state aligned with the backend.
            result = {
              intent: "privacy:consent-agree",
              error: "backend_consent_failed",
              backend_error: resp.error,
              backend_message: resp.message ?? null,
              backend_status: resp.statusCode ?? null,
              hint: "Backend did not record your consent. Check your network / API base URL, then retry.",
            };
            break;
          }
          writeConfig("consent_version", version);
          writeConfig("consent_agreed_at", now);
          deleteConfig("consent_declined");
          deleteConfig("consent_declined_at");
          result = {
            intent: "privacy:consent-agree",
            version,
            agreedAt: now,
            // consentId confirmed by the backend (so the AI can tell the user "backend recorded it").
            consentId: resp?.consentId ?? null,
          };
          break;
        }

        case "consent-decline":
          const declinedAt = isoNow();
          writeConfig("consent_declined", "true");
          writeConfig("consent_declined_at", declinedAt);
          result = {
            intent: "privacy:consent-decline",
            mode: "local_only",
            declinedAt,
          };
          break;

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
            hint: "Available: status | trust | untrust | delete-all | consent-agree | consent-decline | disable-redact | enable-redact",
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
          let uploaded = false;
          if (hasConsent(config) && !isConsentDeclined(config)) {
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
  privacy status          Show consent + trusted skills
  privacy trust <skillId>      Trust a skill
  privacy untrust <skillId>    Revoke trust
  privacy delete-all --confirm  GDPR erasure
  privacy consent-agree [version]  Record consent
  privacy consent-decline      Decline consent (local-only mode)
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
