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
  // Return structured notify:plan JSON for AI to execute via openclaw cron add.
  // Zero-subprocess: Mapick does NOT spawn child processes; AI runs the commands.
  return {
    intent: "notify_cron:register_plan",
    target: "mapick-notify",
    purpose: "Daily 9am check for version updates + zombie skills",
    commands: [
      {
        step: 1,
        kind: "instruction",
        instruction:
          "Run `openclaw cron list --json`. Parse the JSON. For EACH entry whose `name` starts with `mapick-notify` or equals `mapick-daily-notify`, run `openclaw cron rm <id>` (using the entry's `id` field). This MUST be by ID — `openclaw cron rm mapick-notify` (by name) silently no-ops. If there are no matching entries, do nothing and continue.",
        rationale:
          "Idempotent: removes any pre-existing mapick cron entries (both `mapick-notify` and legacy `mapick-daily-notify`) before adding a fresh one, so re-running the plan does not accumulate duplicates.",
        optional: true,
      },
      {
        step: 2,
        kind: "command",
        command:
          'openclaw cron add --name mapick-notify --cron "0 9 * * *" --session isolated --message "Run /mapick notify" --best-effort-deliver --timeout-seconds 120',
        optional: false,
        rationale: "Schedule the daily check",
      },
    ],
    what_it_does:
      "Each day at 9am OpenClaw fires the message 'Run /mapick notify'. Your agent sees that, calls /mapick notify, which queries api.mapick.ai/notify/daily-check for any version alerts or zombie warnings.",
    stops:
      "Run `node scripts/shell.js notify:disable` to get the by-id removal plan.",
    after_success_track: "node scripts/shell.js notify:track setup_complete",
    delivery:
      "Cron delivery requires a configured channel (Telegram, Slack, etc.). In local-only setups without a channel, the cron will execute but notifications cannot reach you. Verify with `openclaw cron list --json` after setup.",
    verification: {
      command: "openclaw cron list --json",
      success_condition:
        "Find the mapick-notify job and confirm it exists with the expected schedule.",
      failure_message:
        "Cron entry not found. Re-run the notify:plan commands.",
    },
  };
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
      null,
      "status",
    );
    if (status && !status.error) {
      summary.has_backend = true;
      if (Array.isArray(status.top_used)) summary.top_used = status.top_used;
      if (status.security) summary.security = status.security;
    }
  } catch {
    // graceful degrade — local data is still returned
  }

  // Day-1 taste tags: compute from local data so every summary/status/report
  // response carries shareable identity labels. No backend call needed.
  summary.taste_tags = computeTasteTags(summary);

  return summary;
}

function computeTasteTags(data) {
  const { total, active, never_used, top_used } = data;
  if (!total) return null;
  const rate = total > 0 ? active / total : 0;
  const names = (top_used || []).map(s => (s.name || "").toLowerCase()).join(" ");

  const tags = [];

  // Quantity
  if (total >= 40) tags.push("收藏癖 Collector");
  else if (total >= 15) tags.push("实用主义 Pragmatist");
  else if (total >= 5) tags.push("极简主义 Minimalist");
  else tags.push("刚起步 Newbie");

  // Efficiency
  if (rate < 0.3) tags.push("囤货不用型 Hoarder");
  else if (rate < 0.6) tags.push("还在探索 Explorer");
  else if (rate < 0.9) tags.push("效率选手 Optimizer");
  else tags.push("断舍离大师 Marie Kondo");

  // Stack
  if (/github|docker|k8s/.test(names)) tags.push("硬核极客 Hardcore Geek");
  else if (/summarize|writing|content/.test(names)) tags.push("内容创作者 Creator");
  else if (/data.analysis|visualization/.test(names)) tags.push("数据控 Data Nerd");
  else if (/productivity|calendar|email/.test(names)) tags.push("效率狂人 Productivity Freak");
  else tags.push("杂食动物 Omnivore");

  // Bonus zombie — replaces the weakest tag when strongly differentiating.
  if (never_used > 5) tags.push("装了不用协会会长 Install-and-Forget Champion");

  // Pick top 3 most differentiating. When bonus tag is present (never_used > 5),
  // it replaces the Stack tag (index 2) since "装了不用" is a stronger signal
  // than "杂食动物 Omnivore" for most users.
  const top3 = tags.length > 3 && tags[tags.length - 1].startsWith("装了不用")
    ? [tags[0], tags[1], tags[tags.length - 1]]
    : tags.slice(0, 3);

  // Brag line
  let fact = "";
  if (total > 40) fact = "你装的 Skill 数量超过 82% 的用户";
  else if (total > 20) fact = "你装的 Skill 数量超过 60% 的用户";
  else if (total > 10) fact = "你装的 Skill 数量超过 40% 的用户";

  return {
    tags: top3,
    fact,
    cta: "📤 测测你朋友的 → /mapick status",
  };
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
    writeConfig("first_welcome_shown", "true");
    return {
      status: "first_install",
      welcome: true,
      data: {
        skillsCount: skills.length,
        skillNames: skills.slice(0, 5).map((s) => s.name),
      },
      privacy: "Anonymous by design. No registration.",
      taste_tags: computeTasteTags({ total: skills.length, active: skills.length, never_used: 0, top_used: [] }),
    };
  }

  // First welcome card — shown once, then never again
  if (!ctx.config.first_welcome_shown) {
    writeConfig("first_welcome_shown", "true");
    const summary = await aggregateSummary(skills, ctx.config);
    return {
      intent: "status",
      welcome: true,
      skills,
      activation_rate: summary.activation_rate,
      zombie_count: summary.zombie_count,
      taste_tags: summary.taste_tags,
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

  // Detect workspace shadow: if a workspace copy shadows managed mapick
  const home = process.env.HOME || "";
  const managedSkillFile = path.join(home, ".openclaw", "skills", "mapick", "SKILL.md");
  const workspaceDuplicate = path.join(home, ".openclaw", "workspace", "skills", "mapick");
  const workspaceSkillFile = path.join(workspaceDuplicate, "SKILL.md");
  const managedExists = fs.existsSync(managedSkillFile);
  const workspaceExists = fs.existsSync(workspaceSkillFile);
  const workspaceShadow = managedExists && workspaceExists;

  // Welcome card — trigger once if never shown
  if (!fresh.first_welcome_shown && fresh.device_fp) {
    writeConfig("first_welcome_shown", "true");
    const summary = await aggregateSummary(skills, fresh);
    return {
      intent: "status",
      welcome: true,
      skills,
      activation_rate: summary.activation_rate,
      zombie_count: summary.zombie_count,
      taste_tags: summary.taste_tags,
      workspace_shadow: workspaceShadow,
      workspace_shadow_path: workspaceShadow ? workspaceDuplicate : null,
    };
  }

  const summary = await aggregateSummary(skills, fresh);
  summary.workspace_shadow = workspaceShadow;
  summary.workspace_shadow_path = workspaceShadow ? workspaceDuplicate : null;
  return summary;
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
  computeTasteTags,
  handleInit,
  handleStatus,
  handleScan,
  handleSummary,
};
