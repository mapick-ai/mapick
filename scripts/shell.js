#!/usr/bin/env node
// Mapick skill entry point. Usage: node shell.js <command> [args...]

const fs = require("fs");
const path = require("path");
const https = require("https");
const os = require("os");
const { execSync } = require("child_process");

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

const CONFIG_DIR = path.dirname(__dirname);
const CONFIG_FILE = path.join(CONFIG_DIR, "CONFIG.md");
const TRASH_DIR = path.join(CONFIG_DIR, "trash");
const REDACTJS_PATH = path.join(CONFIG_DIR, "redact.js");
const API_BASE = "https://api.mapick.ai/api/v1";
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
const CACHE_DIR = path.join(os.homedir(), ".mapick", "cache");
const OUT_ARR = parseInt(process.env.MAPICK_OUTPUT_ARRAY_LIMIT || "10", 10);
const OUT_STR = parseInt(process.env.MAPICK_OUTPUT_STRING_LIMIT || "4000", 10);
const SCAN_LIMIT = parseInt(process.env.MAPICK_SCAN_LIMIT || "50", 10);

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

const VALID_TRACK_ACTIONS = ["shown", "click", "install", "installed", "ignore", "not_interested"];
const VALID_EVENT_ACTIONS = ["skill_install", "skill_invoke", "skill_idle", "skill_uninstall", "rec_shown", "rec_click", "rec_ignore", "rec_installed", "sequence_pattern"];
const PROTECTED_SKILLS = ["mapick", "tasa"];
const REMOTE_COMMANDS = new Set(["recommend", "recommend:track", "search", "workflow", "daily", "weekly", "report", "security", "security:report", "clean", "clean:track", "share"]);

function deviceFp() {
  const config = readConfig();
  if (config.device_fp) return config.device_fp;
  const fp = stableHash16(`${os.hostname()}|${os.platform()}|${os.homedir()}`);
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

// Use curl, not https.request: Node 24 on macOS throws
// UNABLE_TO_VERIFY_LEAF_SIGNATURE because bundled CAs miss intermediates the
// system keychain trusts; `--use-system-ca` is unreliable in 24.x.
async function httpCall(method, endpoint, body = null) {
  const base = API_BASE.replace(/\/$/, "") + "/";
  const url = new URL(endpoint.replace(/^\//, ""), base);
  const STATUS_DELIM = "___MAPICK_HTTP_STATUS___";

  // %{http_code} after a unique delimiter so JSON newlines don't confuse parsing.
  const args = [
    "-sSL",
    "-X", method,
    "-m", "15",
    "-H", "Content-Type: application/json",
    "-H", `x-device-fp: ${deviceFp()}`,
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
        } else if (code === 401) {
          resolve({ error: "unauthorized", statusCode: 401 });
        } else if (code === 404) {
          resolve({ error: "not_found", statusCode: 404 });
        } else if (code === 429) {
          resolve({ error: "rate_limit", statusCode: 429 });
        } else if (code >= 400) {
          try {
            const parsed = JSON.parse(data);
            resolve({ error: "http_error", statusCode: code, ...parsed });
          } catch {
            resolve({ error: "http_error", statusCode: code, body: data });
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
    cp.on("error", (e) =>
      resolve({ error: "network_error", message: e.message }),
    );
  });
}

async function apiCall(method, endpoint, body, intent) {
  const r = await httpCall(method, endpoint, body);
  if (intent) r.intent = intent;
  return r;
}

const missingArg = (hint) => ({ error: "missing_argument", hint });

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

// Counts `[/` at line start — one per RULES tuple. Auto-follows redact.js changes.
function countRedactRules() {
  const candidates = [REDACTJS_PATH, path.join(__dirname, "redact.js")];
  for (const file of candidates) {
    if (!fs.existsSync(file)) continue;
    try {
      const content = fs.readFileSync(file, "utf8");
      const matches = content.match(/^\s*\[\//gm);
      if (matches && matches.length > 0) return matches.length;
    } catch {}
  }
  return 0;
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
  // V1 placeholder: ~2%/zombie capped at 60%. Replace with real ratio later.
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

  // Backend enrichment skipped without consent.
  if (!hasConsent(config) || isConsentDeclined(config)) return summary;

  const fp = deviceFp();
  try {
    const status = await httpCall("GET", `/assistant/status/${fp}?compact=1`);
    if (status && !status.error) {
      summary.has_backend = true;
      if (Array.isArray(status.top_used)) summary.top_used = status.top_used;
      if (status.security) summary.security = status.security;
    }
  } catch {
    // graceful degrade — local data is still returned
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

// Idempotent (cron rm + cron add). `--session isolated` is required:
// OpenClaw rejects `--session main` without `--system-event`.
function registerNotifyCron() {
  try {
    execSync("command -v openclaw", { stdio: "ignore" });
  } catch {
    return { registered: false, reason: "openclaw_not_found" };
  }
  try {
    execSync("openclaw cron rm mapick-notify", { stdio: "ignore" });
  } catch {}
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
        const zombieDays = parseInt(
          process.env.MAPICK_ZOMBIE_DAYS || "30",
          10,
        );
        const now = Date.now();
        const ageDays = (s) =>
          (now - new Date(s.last_modified).getTime()) / 86_400_000;

        const zombies = skills.filter((s) => ageDays(s) > zombieDays);
        const total = skills.length;
        const active = skills.filter(
          (s) => s.enabled && ageDays(s) <= zombieDays,
        ).length;

        result = {
          intent: "status",
          skills,
          activation_rate:
            total > 0 ? `${Math.round((active / total) * 100)}%` : "0%",
          zombie_count: zombies.length,
          never_used: skills.filter((s) => !s.last_modified).length,
        };

        // Safety-net re-register: recovers from manual cron deletion / prior
        // install racing openclaw. registerNotifyCron is idempotent.
        if (hasConsent(config)) {
          registerNotifyCron();
        }
      }
      break;

    case "scan":
      const scannedSkills = scanSkills();
      result = { intent: "scan", skills: scannedSkills, scanned_at: isoNow() };
      break;

    case "recommend": {
      const withProfile = ARGS.includes("--with-profile");
      const numericArgs = ARGS.filter((a) => !a.startsWith("--"));
      const limit = parseInt(numericArgs[0]) || 5;
      const cacheKey = `recommend_${fp}`;
      const cached = readCache(cacheKey);
      // Explicit limit or --with-profile bypasses the 24h cache.
      const useCache = !withProfile && numericArgs.length === 0;
      if (useCache && cached) {
        result = { intent: "recommend", items: cached.items, cached: true };
      } else {
        let url = `/recommendations/feed?limit=${limit}`;
        if (withProfile) {
          const tagsRaw = config.user_profile_tags || "";
          // JSON array string; on parse failure, fall back to comma-separated.
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
        result = missingArg("Usage: recommend:track <recId> <skillId> <action>");
        break;
      }
      const [recId, skillId, action] = ARGS;
      if (!VALID_TRACK_ACTIONS.includes(action)) {
        result = { error: "invalid_action", valid: VALID_TRACK_ACTIONS };
        break;
      }
      result = await apiCall("POST", "/recommendations/track", { recId, skillId, action, userId: fp }, "recommend:track");
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
      const cleanResp = await httpCall("GET", `/users/${fp}/zombies?limit=${OUT_ARR}`);
      result = {
        intent: "clean",
        zombies: cleanResp.zombies || cleanResp || [],
      };
      break;

    // Single GET /notify/daily-check; backend handles version cmp + zombies + activity bump.
    case "notify": {
      const versionFile = path.join(CONFIG_DIR, ".version");
      let installedVer = "";
      try {
        installedVer = fs.readFileSync(versionFile, "utf8").trim();
      } catch {}
      // Backend has a per-repo allowlist; without `repo` it returns alerts: [].
      const params = new URLSearchParams();
      if (installedVer) params.set("currentVersion", installedVer);
      params.set("repo", "mapick-ai/mapick");
      params.set("compact", "1");
      params.set("limit", String(OUT_ARR));
      const resp = await httpCall("GET", `/notify/daily-check?${params}`);
      // Silence-first: backend/network failure → empty alerts.
      if (resp.error) {
        result = { intent: "notify", alerts: [] };
      } else {
        result = { intent: "notify", ...resp };
      }
      break;
    }

    case "clean:track":
      if (ARGS.length < 1) {
        result = missingArg("Usage: clean:track <skillId>");
        break;
      }
      result = await apiCall("POST", "/events/track", {
        userId: fp,
        skillId: ARGS[0],
        action: "skill_uninstall",
        metadata: { reason: "zombie_cleanup" },
      }, "clean:track");
      break;

    case "uninstall":
      if (ARGS.length < 1) {
        result = missingArg("Usage: uninstall <skillId> [--confirm]");
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
      result = await apiCall("GET", `/assistant/workflow/${fp}?compact=1`, null, "workflow");
      break;

    case "daily":
      result = await apiCall("GET", `/assistant/daily-digest/${fp}?compact=1`, null, "daily");
      break;

    case "weekly":
      result = await apiCall("GET", `/assistant/weekly/${fp}?compact=1`, null, "weekly");
      break;

    case "bundle":
      if (ARGS[0] === "recommend") {
        result = await apiCall("GET", `/bundle/recommend/list?limit=${OUT_ARR}`, null, "bundle:recommend");
      } else if (ARGS[0] === "install" && ARGS[1]) {
        result = await apiCall("GET", `/bundle/${ARGS[1]}/install`, null, "bundle:install");
        result.bundleId = ARGS[1];
      } else if (ARGS[0] === "track-installed" && ARGS[1]) {
        result = await apiCall("POST", "/bundle/seed", { bundleId: ARGS[1], userId: fp }, "bundle:track-installed");
      } else if (ARGS[0]) {
        result = await apiCall("GET", `/bundle/${ARGS[0]}`, null, "bundle:detail");
      } else {
        result = await apiCall("GET", `/bundle?limit=${OUT_ARR}`, null, "bundle");
      }
      break;

    case "report":
      const reportResp = await httpCall("GET", `/report/persona?compact=1`);
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
        result = missingArg("Usage: share <reportId> <htmlFile>");
        break;
      }
      const [reportId, htmlFile] = ARGS;
      if (!fs.existsSync(htmlFile)) {
        result = { error: "file_not_found", file: htmlFile };
        break;
      }
      const htmlContent = redact(fs.readFileSync(htmlFile, "utf8"));
      result = await apiCall("POST", "/share/upload", {
        reportId,
        html: htmlContent,
        locale: ARGS[2] || "en",
      }, "share");
      break;

    case "security":
      if (ARGS.length < 1) {
        result = missingArg("Usage: security <skillId>");
        break;
      }
      result = await apiCall("GET", `/skill/${ARGS[0]}/security`, null, "security");
      break;

    case "security:report":
      if (ARGS.length < 3) {
        result = missingArg("Usage: security:report <skillId> <reason> <evidence>");
        break;
      }
      result = await apiCall("POST", `/skill/${ARGS[0]}/report`, {
        reason: ARGS[1],
        evidenceEn: ARGS[2],
      }, "security:report");
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
            result = missingArg("Usage: privacy trust <skillId>");
            break;
          }
          result = await apiCall("POST", "/users/trusted-skills", {
            userId: fp,
            skillId: ARGS[1],
            permission: "unredacted",
          }, "privacy:trust");
          const trusted = config.trusted_skills
            ? config.trusted_skills.split(",")
            : [];
          trusted.push(ARGS[1]);
          writeConfig("trusted_skills", trusted.join(","));
          break;

        case "untrust":
          if (ARGS.length < 2) {
            result = missingArg("Usage: privacy untrust <skillId>");
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
          // Only write local state on backend success — otherwise local "agreed"
          // would diverge from server, leaving later ConsentGuard calls 403ing.
          const version = ARGS[1] || "1.0";
          const now = isoNow();
          const resp = await httpCall("POST", "/users/consent", {
            consentVersion: version,
            agreedAt: now,
          });
          if (resp && resp.error) {
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
          // Cron failure is non-fatal — consent itself already succeeded.
          const cronResult = registerNotifyCron();
          result = {
            intent: "privacy:consent-agree",
            version,
            agreedAt: now,
            consentId: resp?.consentId ?? null,
            notifyCron: cronResult,
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
        result = missingArg("Usage: event:track <userId> <action> [skillId]");
        break;
      }
      const [userId, actionType, metaSkillId] = ARGS;
      if (!VALID_EVENT_ACTIONS.includes(actionType)) {
        result = { error: "invalid_action", valid: VALID_EVENT_ACTIONS };
        break;
      }
      result = await apiCall("POST", "/events/track", {
        userId,
        action: actionType,
        skillId: metaSkillId || null,
      }, "event:track");
      break;

    case "summary": {
      const skills = scanSkills();
      result = await aggregateSummary(skills, config);
      break;
    }

    case "profile": {
      const subCmd = ARGS[0] || "get";
      switch (subCmd) {
        case "set": {
          const text = ARGS.slice(1).join(" ").trim();
          if (!text) {
            result = missingArg("Usage: profile set \"<workflow text>\"");
            break;
          }
          const tags = extractProfileTags(text);
          writeConfig("user_profile", text);
          writeConfig("user_profile_tags", JSON.stringify(tags));
          writeConfig("user_profile_set_at", isoNow());
          // POST /users/:userId/profile-text — userId in path. Local writes
          // never block on upload failure.
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
          // Clearing also resets first-run flag so init re-triggers the card.
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
      console.error(`Mapick — node shell.js <command> [args...]

Local:    init | status | scan | summary | id | first-run-done
Skills:   recommend [limit] | recommend:track <recId> <skillId> <action>
          search <query> [limit] | clean | clean:track <skillId>
          uninstall <skillId> [--confirm]
Reports:  workflow | daily | weekly | report | share <reportId> <html> [locale]
Bundles:  bundle [id] | bundle install <id> | bundle track-installed <id>
Security: security <skillId> | security:report <skillId> <reason> <evidence>
Privacy:  privacy {status|trust <id>|untrust <id>|delete-all --confirm
                 |consent-agree [ver]|consent-decline
                 |disable-redact|enable-redact}
Events:   event:track <userId> <action> [skillId]
Profile:  profile {set "<text>"|get|clear}`);
      result = { error: "usage" };
      break;

    default:
      result = {
        error: "unknown_command",
        command: COMMAND,
        hint: "Run help for usage",
      };
  }

  console.log(JSON.stringify(clampOutput(result)));
}

main().catch((e) => console.log(JSON.stringify({ error: e.message })));
