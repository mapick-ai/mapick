// Skill scanning, init/status/scan/summary handlers, notify cron registration.

const fs = require("fs");
const path = require("path");
const {
  CONFIG_DIR, REDACTJS_PATH, SCRIPTS_DIR, SKILLS_BASES,
  isoNow, parseFrontmatter,
  readConfig, writeConfig,
  isConsentDeclined,
} = require("./core");
const { httpCall } = require("./http");

// Walk both ~/.openclaw/skills/ (managed) and ~/.openclaw/workspace/skills/
// (workspace) and merge. OpenClaw loads workspace before managed, so when a
// skill id appears in both we keep the workspace record but flag
// `shadowed_by_managed: true` so the AI can mention it.
function scanSkills() {
  const byId = new Map();
  for (const { path: base, source } of SKILLS_BASES) {
    if (!fs.existsSync(base)) continue;
    let entries;
    try {
      entries = fs.readdirSync(base);
    } catch {
      continue;
    }
    for (const dir of entries) {
      try {
        const skillPath = path.join(base, dir);
        const linkStat = fs.lstatSync(skillPath);
        if (linkStat.isSymbolicLink()) continue;
        const stat = fs.statSync(skillPath);
        const skillFile = path.join(skillPath, "SKILL.md");
        if (!stat.isDirectory() || !fs.existsSync(skillFile)) continue;
        const content = fs.readFileSync(skillFile, "utf8");
        const fm = parseFrontmatter(content);
        const skillStat = fs.statSync(skillFile);
        const record = {
          id: dir,
          name: typeof fm.name === "string" && fm.name ? fm.name : dir,
          path: skillPath,
          source,
          installed_at: stat.birthtime.toISOString(),
          last_modified: skillStat.mtime.toISOString(),
          enabled: fm.disabled !== true,
        };
        if (byId.has(dir)) {
          // Earlier iteration found this id under managed; workspace wins
          // (matches OpenClaw load order). Mark the shadow on the new
          // (workspace) record so callers can disambiguate.
          record.shadowed_by_managed = true;
        }
        byId.set(dir, record);
      } catch {}
    }
  }
  return [...byId.values()];
}

// scanAllSkills returns one record per (id, source) — no dedup. Used by
// uninstall to detect "skill exists in BOTH bases" ambiguity.
function scanAllSkills() {
  const out = [];
  for (const { path: base, source } of SKILLS_BASES) {
    if (!fs.existsSync(base)) continue;
    let entries;
    try {
      entries = fs.readdirSync(base);
    } catch {
      continue;
    }
    for (const dir of entries) {
      try {
        const skillPath = path.join(base, dir);
        const linkStat = fs.lstatSync(skillPath);
        if (linkStat.isSymbolicLink()) continue;
        const stat = fs.statSync(skillPath);
        const skillFile = path.join(skillPath, "SKILL.md");
        if (!stat.isDirectory() || !fs.existsSync(skillFile)) continue;
        out.push({ id: dir, path: skillPath, source });
      } catch {}
    }
  }
  return out;
}

function countRedactRules() {
  try {
    return require("../redact").RULE_COUNT || 0;
  } catch {
    return 0;
  }
}

function registerNotifyCron() {
  return { registered: false, reason: "cron_registration_disabled_in_scan_safe_build" };
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

  // Backend enrichment skipped only when the user explicitly declined.
  if (isConsentDeclined(config)) return summary;

  try {
    const status = await httpCall(
      "GET",
      `/assistant/status/${config.device_fp}?compact=1`,
    );
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

async function handleInit(_args, ctx) {
  const lastInit = ctx.config.last_init_at
    ? new Date(ctx.config.last_init_at).getTime()
    : 0;
  const cooldown =
    parseInt(process.env.MAPICK_INIT_INTERVAL_MINUTES || "30") * 60000;
  if (Date.now() - lastInit < cooldown) {
    return { status: "skip", reason: "cooldown" };
  }
  writeConfig("last_init_at", isoNow());
  const skills = scanSkills();
  if (!ctx.config.device_fp) {
    writeConfig("created_at", isoNow());
    return {
      status: "first_install",
      data: {
        skillsCount: skills.length,
        skillNames: skills.slice(0, 5).map((s) => s.name),
      },
      privacy: "Anonymous by design. No registration.",
    };
  }
  const zombieDays = parseInt(process.env.MAPICK_ZOMBIE_DAYS || "30", 10);
  const now = Date.now();
  const ageDays = (s) =>
    (now - new Date(s.last_modified).getTime()) / 86_400_000;
  const zombies = skills.filter((s) => ageDays(s) > zombieDays);
  const total = skills.length;
  const active = skills.filter(
    (s) => s.enabled && ageDays(s) <= zombieDays,
  ).length;

  // Safety-net re-register: recovers from manual cron deletion / prior
  // install racing openclaw. registerNotifyCron is idempotent. Skipped
  // only for users who explicitly declined data sharing.
  if (!isConsentDeclined(ctx.config)) registerNotifyCron();

  return {
    intent: "status",
    skills,
    activation_rate:
      total > 0 ? `${Math.round((active / total) * 100)}%` : "0%",
    zombie_count: zombies.length,
    never_used: skills.filter(
      (s) => s.installed_at && s.last_modified === s.installed_at,
    ).length,
  };
}

async function handleStatus(_args, ctx) {
  const skills = scanSkills();
  const fresh = readConfig();
  fresh.device_fp = fresh.device_fp || ctx.fp;
  return aggregateSummary(skills, fresh);
}

function handleScan() {
  return { intent: "scan", skills: scanSkills(), scanned_at: isoNow() };
}

async function handleSummary(_args, ctx) {
  const skills = scanSkills();
  const fresh = readConfig();
  fresh.device_fp = fresh.device_fp || ctx.fp;
  return aggregateSummary(skills, fresh);
}

module.exports = {
  scanSkills,
  scanAllSkills,
  countRedactRules,
  registerNotifyCron,
  aggregateSummary,
  handleInit,
  handleStatus,
  handleScan,
  handleSummary,
};
