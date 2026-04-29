// Update detection + plan rendering. All commands are zero-subprocess —
// Mapick only DETECTS and RETURNS plans. Actual install/upgrade is run
// by the AI via its bash tool after explicit user confirmation.
//
// See SKILL.md §10 for the full flow.

const fs = require("fs");
const path = require("path");
const {
  CONFIG_DIR, OUT_ARR, SKILLS_BASE,
  isoNow, parseFrontmatter,
  readConfig, writeConfig, deleteConfig,
  isConsentDeclined,
} = require("./core");
const { httpCall, missingArg } = require("./http");

const NOTIFY_STALE_DAYS = 7;            // notify hasn't run for 7 days → stale
const NOTIFY_DISMISSED_DAYS = 14;       // user said "later" → silent for 14 days
const SKILL_DISMISSED_DAYS = 7;         // single-skill dismissal → 7 days
const VALID_UPDATE_MODES = new Set(["off", "on"]);

// Default mode = "on": detect + tell user. "off" disables detection entirely.
function getUpdateMode(config) {
  const m = config.update_mode || "on";
  return VALID_UPDATE_MODES.has(m) ? m : "on";
}

// Compares two ISO strings; returns elapsed days (or Infinity if either is missing).
function daysSince(iso) {
  if (!iso) return Infinity;
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return Infinity;
  return (Date.now() - t) / 86_400_000;
}

// `update_dismissed` in CONFIG.md is a comma-separated list of
// `<id>:<version>:<iso>` tuples. Returns Map<"id:version", iso>.
function parseDismissed(config) {
  const raw = config.update_dismissed || "";
  const map = new Map();
  for (const entry of raw.split(",").filter(Boolean)) {
    const lastColon = entry.lastIndexOf(":");
    const secondLast = entry.lastIndexOf(":", lastColon - 1);
    if (lastColon < 0 || secondLast < 0) continue;
    const id = entry.slice(0, secondLast);
    const version = entry.slice(secondLast + 1, lastColon);
    const iso = entry.slice(lastColon + 1);
    map.set(`${id}:${version}`, iso);
  }
  return map;
}

function serializeDismissed(map) {
  const out = [];
  for (const [key, iso] of map) {
    out.push(`${key}:${iso}`);
  }
  return out.join(",");
}

function isDismissedActive(map, id, version) {
  const iso = map.get(`${id}:${version}`);
  if (!iso) return false;
  return daysSince(iso) < SKILL_DISMISSED_DAYS;
}

function readInstalledVersion() {
  const versionFile = path.join(CONFIG_DIR, ".version");
  try {
    return fs.readFileSync(versionFile, "utf8").trim();
  } catch {
    return null;
  }
}

function scanInstalledSkills() {
  const out = [];
  if (!fs.existsSync(SKILLS_BASE)) return out;
  for (const dir of fs.readdirSync(SKILLS_BASE)) {
    const skillFile = path.join(SKILLS_BASE, dir, "SKILL.md");
    if (!fs.existsSync(skillFile)) continue;
    try {
      const fm = parseFrontmatter(fs.readFileSync(skillFile, "utf8"));
      out.push({
        id: dir,
        name: typeof fm.name === "string" && fm.name ? fm.name : dir,
        version: typeof fm.version === "string" ? fm.version : null,
      });
    } catch {}
  }
  return out;
}

// `update:check` — detect 4 categories, return items[] for AI to render.
async function handleCheck(_args, ctx) {
  const config = readConfig();
  const mode = getUpdateMode(config);
  if (mode === "off") {
    return {
      intent: "update:check",
      checked_at: isoNow(),
      settings: { update_mode: "off" },
      items: [],
      message: "Update detection disabled. Run `node scripts/shell.js update:settings on` to re-enable.",
    };
  }
  if (isConsentDeclined(config)) {
    return {
      intent: "update:check",
      checked_at: isoNow(),
      settings: { update_mode: mode },
      items: [],
      message: "Remote checks disabled (you opted out). Run `node scripts/shell.js privacy consent-agree` to resume.",
    };
  }

  const items = [];
  const dismissed = parseDismissed(config);

  // 1. Mapick self version.
  const installedVer = readInstalledVersion();
  if (installedVer) {
    const params = new URLSearchParams({
      currentVersion: installedVer,
      repo: "mapick-ai/mapick",
      compact: "1",
      limit: String(OUT_ARR),
    });
    const resp = await httpCall("GET", `/notify/daily-check?${params}`);
    if (!resp.error && Array.isArray(resp.alerts)) {
      const baseVersion = installedVer.split("-")[0];
      for (const alert of resp.alerts) {
        if (alert?.type !== "version") continue;
        if (alert.latest && baseVersion === String(alert.latest).split("-")[0]) continue;
        if (isDismissedActive(dismissed, "mapick", alert.latest)) continue;
        items.push({
          type: "mapick_self",
          current: alert.current || installedVer,
          latest: alert.latest,
          severity: "info",
          summary: `Mapick ${alert.current || installedVer} → ${alert.latest}.`,
          next: {
            command: "node scripts/shell.js upgrade:plan mapick",
            trigger_phrases: ["upgrade mapick", "升级 mapick", "update mapick"],
          },
        });
      }
    }
  }

  // 2. notify_missing — heuristic from last_notify_at + dismissal.
  const lastNotify = config.last_notify_at;
  const notifyStale = daysSince(lastNotify) > NOTIFY_STALE_DAYS;
  const notifyDismissedActive =
    daysSince(config.notify_setup_dismissed_at) < NOTIFY_DISMISSED_DAYS;
  if (notifyStale && !notifyDismissedActive) {
    items.push({
      type: "notify_missing",
      reason: lastNotify ? "stale_last_run" : "never_run",
      last_run_at: lastNotify || null,
      severity: "info",
      summary: lastNotify
        ? `Daily reminders may not be running (last check: ${Math.round(daysSince(lastNotify))} days ago).`
        : "Daily reminders not set up — Mapick won't ping you proactively.",
      next: {
        command: "node scripts/shell.js notify:plan",
        trigger_phrases: ["set up daily reminders", "开通知", "帮我装 notify", "set up notify"],
      },
    });
  }

  // 3. Installed skill updates (best-effort; backend endpoint may not exist yet).
  const skills = scanInstalledSkills();
  if (skills.length > 0) {
    const payload = {
      skills: skills.map((s) => ({ id: s.id, version: s.version })),
    };
    const resp = await httpCall("POST", "/skills/check-updates", payload);
    if (!resp.error && Array.isArray(resp.results)) {
      for (const r of resp.results) {
        if (!r.hasUpdate) continue;
        if (isDismissedActive(dismissed, r.id, r.latestVersion)) continue;
        const skill = skills.find((s) => s.id === r.id);
        items.push({
          type: "skill",
          id: r.id,
          name: skill?.name || r.id,
          current: r.currentVersion,
          latest: r.latestVersion,
          severity: r.severity || "info",
          summary: `${skill?.name || r.id} ${r.currentVersion} → ${r.latestVersion}.`,
          next: {
            command: `node scripts/shell.js upgrade:plan ${r.id}`,
            trigger_phrases: [`upgrade ${r.id}`, `升级 ${r.id}`],
          },
        });
      }
    }
    // Endpoint not deployed yet → resp.error is "not_found" or similar; skip silently.
  }

  return {
    intent: "update:check",
    checked_at: isoNow(),
    settings: { update_mode: mode },
    items,
  };
}

// `notify:plan` — return the cron-registration plan for AI to execute.
function handleNotifyPlan() {
  return {
    intent: "notify_setup:plan",
    target: "mapick-notify",
    purpose: "Daily 9am check for version updates + zombie skills",
    commands: [
      {
        step: 1,
        command: "openclaw cron rm mapick-notify",
        optional: true,
        rationale: "Remove any existing entry first (idempotent; ignore exit code)",
      },
      {
        step: 2,
        command:
          'openclaw cron add --name mapick-notify --cron "0 9 * * *" --session isolated --message "Run /mapick notify" --best-effort-deliver --timeout-seconds 120',
        optional: false,
        rationale: "Schedule the daily check",
      },
    ],
    what_it_does:
      "Each day at 9am OpenClaw fires the message 'Run /mapick notify'. Your agent sees that, calls /mapick notify, which queries api.mapick.ai/notify/daily-check for any version alerts or zombie warnings.",
    what_it_doesnt:
      "No data leaves your machine on registration. The cron only schedules a future trigger; it does not itself send anything.",
    stops:
      "Run `openclaw cron rm mapick-notify` any time. Or run `node scripts/shell.js notify:disable` to get this same command back.",
    after_success_track: "node scripts/shell.js notify:track setup_complete",
    after_failure_rollback: null,
  };
}

// `notify:disable` — symmetrical to notify:plan; returns the rm-only plan.
function handleNotifyDisable() {
  return {
    intent: "notify_disable:plan",
    target: "mapick-notify",
    commands: [
      {
        step: 1,
        command: "openclaw cron rm mapick-notify",
        optional: false,
        rationale: "Remove the daily-notify cron",
      },
    ],
    what_it_does:
      "Stops Mapick from receiving the 9am daily message. /mapick notify still works manually.",
    what_it_doesnt:
      "Does not remove any data, history, or settings — only the schedule.",
    stops: "Run `node scripts/shell.js notify:plan` to set it up again later.",
    after_success_track: "node scripts/shell.js notify:track disable_complete",
    after_failure_rollback: null,
  };
}

// `upgrade:plan <id>` — return install plan for mapick or any installed skill.
function handleUpgradePlan(args) {
  const target = args[0];
  if (!target) return missingArg("Usage: upgrade:plan <id>  (id = `mapick` or any installed skill id)");

  if (target === "mapick") {
    return {
      intent: "upgrade:plan",
      target: { type: "mapick_self", id: "mapick" },
      commands: [
        {
          step: 1,
          command: "openclaw skills install mapick",
          optional: false,
          rationale: "Replace current install with the latest published version",
        },
      ],
      what_it_does:
        "Fetches the latest Mapick from ClawHub and replaces your current install. Your CONFIG.md (consent state, dismissals, profile) is preserved by the installer.",
      what_it_doesnt:
        "Does not touch other Skills. Does not modify ~/.openclaw/ outside ~/.openclaw/skills/mapick/.",
      stops:
        "Cancel before running. After the install you can `git checkout` an older version inside the install dir if needed.",
      after_success_track: "node scripts/shell.js update:track mapick latest success",
      after_failure_rollback: null,
    };
  }

  // Skill upgrade — Mapick handles the backup step itself; OpenClaw does the install.
  return {
    intent: "upgrade:plan",
    target: { type: "skill", id: target },
    commands: [
      {
        step: 1,
        command: `node scripts/shell.js backup:create ${target}`,
        optional: false,
        rationale: "Mapick copies the current install into ~/.openclaw/skills/mapick/trash/",
        executes_in_mapick: true,
      },
      {
        step: 2,
        command: `openclaw skills install ${target}`,
        optional: false,
        rationale: "OpenClaw fetches and installs the latest version",
      },
    ],
    what_it_does: `Backs up the current ${target}/ directory, then runs \`openclaw skills install ${target}\` which fetches the latest version.`,
    what_it_doesnt:
      "Mapick does not call openclaw on its own; you (or your agent) run the install command. Other Skills are not touched.",
    stops:
      "Cancel before step 2 — backup is harmless on its own. Restore with `node scripts/shell.js backup:restore <id>` if step 2 went wrong.",
    after_success_track: `node scripts/shell.js update:track ${target} latest success`,
    after_failure_rollback: `node scripts/shell.js backup:restore ${target}`,
  };
}

// `update:track <id> <version> <result>` — AI reports the outcome.
function handleUpdateTrack(args) {
  if (args.length < 3) return missingArg("Usage: update:track <id> <version> <success|fail>");
  const [id, version, result] = args;
  appendInstallLog({
    ts: isoNow(),
    kind: "upgrade",
    id,
    version,
    result,
  });
  if (id === "mapick" && result === "success") {
    // Mapick replaced itself; nothing more to do — next launch picks up the new code.
  }
  return { intent: "update:track", id, version, result, recorded: true };
}

// `notify:track <result>` — AI reports cron registration result.
function handleNotifyTrack(args) {
  const result = args[0] || "unknown";
  appendInstallLog({
    ts: isoNow(),
    kind: "notify_setup",
    result,
  });
  if (result === "setup_complete") {
    // Reset stale flag — cron is fresh.
    writeConfig("last_notify_at", isoNow());
    deleteConfig("notify_setup_dismissed_at");
  } else if (result === "disable_complete") {
    deleteConfig("last_notify_at");
  }
  return { intent: "notify:track", result, recorded: true };
}

// `update:settings <off|on>`
function handleSettings(args) {
  const mode = (args[0] || "").toLowerCase();
  if (!VALID_UPDATE_MODES.has(mode)) {
    return missingArg(`Usage: update:settings <${[...VALID_UPDATE_MODES].join("|")}>`);
  }
  writeConfig("update_mode", mode);
  return { intent: "update:settings", update_mode: mode };
}

// `update:dismissed <id> [version]` — drop one or more items into dismissal list.
// Pass `notify_setup` as id to dismiss the cron-setup prompt for 14 days.
function handleDismissed(args) {
  if (args.length < 1) return missingArg("Usage: update:dismissed <id> [version]");
  const id = args[0];
  if (id === "notify_setup") {
    writeConfig("notify_setup_dismissed_at", isoNow());
    return { intent: "update:dismissed", id: "notify_setup", days: NOTIFY_DISMISSED_DAYS };
  }
  const version = args[1] || "any";
  const config = readConfig();
  const map = parseDismissed(config);
  map.set(`${id}:${version}`, isoNow());
  writeConfig("update_dismissed", serializeDismissed(map));
  return { intent: "update:dismissed", id, version, days: SKILL_DISMISSED_DAYS };
}

// `notify:status` — read last_notify_at + report cron health inference.
function handleNotifyStatus() {
  const config = readConfig();
  const lastNotify = config.last_notify_at;
  return {
    intent: "notify:status",
    last_notify_at: lastNotify || null,
    days_since_last: lastNotify ? Math.round(daysSince(lastNotify) * 10) / 10 : null,
    looks_active: lastNotify && daysSince(lastNotify) <= NOTIFY_STALE_DAYS,
    setup_dismissed_until: config.notify_setup_dismissed_at
      ? new Date(
          new Date(config.notify_setup_dismissed_at).getTime() +
            NOTIFY_DISMISSED_DAYS * 86_400_000,
        ).toISOString()
      : null,
  };
}

// Append-only log of install/upgrade actions, mirrors outbound.jsonl.
function appendInstallLog(entry) {
  try {
    const os = require("os");
    const logDir = path.join(os.homedir(), ".mapick", "logs");
    if (!fs.existsSync(logDir)) fs.mkdirSync(logDir, { recursive: true });
    const logFile = path.join(logDir, "install.jsonl");
    fs.appendFileSync(logFile, JSON.stringify(entry) + "\n");
  } catch {}
}

module.exports = {
  handleCheck,
  handleNotifyPlan,
  handleNotifyDisable,
  handleUpgradePlan,
  handleUpdateTrack,
  handleNotifyTrack,
  handleSettings,
  handleDismissed,
  handleNotifyStatus,
};
