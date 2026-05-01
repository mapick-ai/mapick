// Bundle, persona report, share, profile, workflow/daily/weekly/notify/event,
// first-run-done, id, help, unknown — all the small handlers.

const fs = require("fs");
const path = require("path");
const {
  CONFIG_DIR, OUT_ARR, VALID_EVENT_ACTIONS,
  isoNow, extractProfileTags, redactForUpload,
  readConfig, writeConfig, deleteConfig,
  isConsentDeclined, readInstalledVersion,
} = require("./core");
const { httpCall, apiCall, missingArg } = require("./http");

async function handleWorkflow(_args, ctx) {
  return apiCall(
    "GET",
    `/assistant/workflow/${ctx.fp}?compact=1`,
    null,
    "workflow",
  );
}

async function handleDaily(_args, ctx) {
  const result = await apiCall(
    "GET",
    `/assistant/daily-digest/${ctx.fp}?compact=1`,
    null,
    "daily",
  );
  return attachDay1Summary(result, ctx);
}

async function handleWeekly(_args, ctx) {
  return apiCall(
    "GET",
    `/assistant/weekly/${ctx.fp}?compact=1`,
    null,
    "weekly",
  );
}

// Single GET /notify/daily-check; backend handles version cmp + zombies + activity bump.
async function handleNotify() {
  const installedVer = readInstalledVersion() || "";
  // Local / dev builds are by definition ahead of any tagged release; don't
  // surface mapick_self version alerts for them — that just nags during dev
  // validation. Still write last_notify_at + return silence-first {alerts:[]}.
  const isDevBuild = /^(local|dev)-/.test(installedVer);
  // Backend has a per-repo allowlist; without `repo` it returns alerts: [].
  const params = new URLSearchParams();
  if (installedVer) params.set("currentVersion", installedVer);
  params.set("repo", "mapick-ai/mapick");
  params.set("compact", "1");
  params.set("limit", String(OUT_ARR));
  const resp = await httpCall("GET", `/notify/daily-check?${params}`);
  const recommendations = await fetchRecommendations(2);
  // Silence-first: backend/network failure → empty alerts.
  if (resp.error) {
    return { intent: "notify", alerts: [], dev_build: isDevBuild, recommendations };
  }
  if (Array.isArray(resp.alerts) && installedVer) {
    const baseVersion = installedVer.split("-")[0];
    resp.alerts = resp.alerts.filter((alert) => {
      if (alert?.type !== "version") return true;
      // Drop version alerts entirely on dev builds.
      if (isDevBuild) return false;
      return !(alert.latest && baseVersion === String(alert.latest).split("-")[0]);
    });
  }
  // Track liveness — used by `update:check` to detect stale notify and prompt
  // the user to (re)set up the cron.
  writeConfig("last_notify_at", isoNow());
  return { intent: "notify", dev_build: isDevBuild, recommendations, ...resp };
}

async function fetchRecommendations(limit = 2) {
  try {
    const resp = await httpCall("GET", `/recommendations/feed?limit=${limit}`);
    if (resp.error) return [];
    return (resp.items || resp.recommendations || []).slice(0, limit);
  } catch {
    return [];
  }
}

async function handleBundle(args, ctx) {
  const sub = args[0];
  if (sub === "recommend") {
    return apiCall(
      "GET",
      `/bundle/recommend/list?limit=${OUT_ARR}`,
      null,
      "bundle:recommend",
    );
  }
  if (sub === "install") {
    if (!args[1]) return missingArg("Usage: bundle install <bundleId>");
    const r = await apiCall(
      "GET",
      `/bundle/${args[1]}/install`,
      null,
      "bundle:install",
    );
    r.bundleId = args[1];
    return r;
  }
  if (sub === "track-installed" && args[1]) {
    return apiCall(
      "POST",
      "/bundle/seed",
      { bundleId: args[1], userId: ctx.fp },
      "bundle:track-installed",
    );
  }
  if (sub) {
    return apiCall("GET", `/bundle/${sub}`, null, "bundle:detail");
  }
  return apiCall("GET", `/bundle?limit=${OUT_ARR}`, null, "bundle");
}

async function attachDay1Summary(result, ctx) {
  try {
    const { scanSkills, aggregateSummary } = require("./skills");
    const config = ctx.config || readConfig();
    const summaryConfig = {
      ...config,
      device_fp: config.device_fp || ctx.fp,
    };
    const localSummary = await aggregateSummary(scanSkills(), summaryConfig);
    // aggregateSummary already calls computeTasteTags internally and stores
    // the result in localSummary.taste_tags — use it directly to avoid
    // double-computation and type drift (null vs []).
    const tt = localSummary.taste_tags;
    result.day1_summary = localSummary;
    result.taste_tags = tt ? tt.tags : null;
    result.taste_fact = tt ? tt.fact : null;
    result.next_action_hint =
      "Persona data is still brewing, but day-1 summary and taste tags are ready to render.";
  } catch (err) {
    result.day1_summary_error = err.message;
  }
  return result;
}

async function handleReport(_args = [], ctx = {}) {
  const reportResp = await httpCall("GET", `/report/persona?compact=1`);
  if (reportResp.error === "rate_limit") {
    return attachDay1Summary(
      {
        intent: "report",
        status: "brewing",
        fallback: "local_day1_summary",
        messageEn:
          "Persona data is still brewing, but Mapick can show a local day-1 summary right now.",
      },
      ctx,
    );
  }

  const result = { intent: "report", ...reportResp };
  if (result.error) {
    result.status = "brewing";
    result.fallback = "local_day1_summary";
    result.messageEn =
      result.messageEn ||
      "Persona backend is temporarily unavailable, but Mapick can still show a local day-1 summary.";
    return attachDay1Summary(result, ctx);
  }
  if (
    result.status === "brewing" ||
    result.primaryPersona?.id === "fresh_meat"
  ) {
    result.status = result.status || "brewing";
    result.messageEn =
      result.messageEn ||
      ":lock: Your persona is brewing. Use Mapick for a few more skill actions before generating a shareable report.";
    await attachDay1Summary(result, ctx);
  }
  return result;
}

async function handleShare(args) {
  if (args.length < 2) return missingArg("Usage: share <reportId> <htmlFile>");
  const [reportId, htmlFile] = args;
  if (!/^[A-Za-z0-9_-]{1,80}$/.test(reportId)) {
    return { error: "invalid_report_id", hint: "Report IDs may contain letters, numbers, underscore, or dash." };
  }
  const absolute = path.resolve(htmlFile);
  const tmpDir = fs.realpathSync("/tmp");
  const basename = path.basename(absolute);
  if (!/^mapick-report-[A-Za-z0-9_-]+\.html$/.test(basename)) {
    return {
      error: "invalid_share_file",
      hint: "Share only uploads Mapick-generated reports saved as /tmp/mapick-report-<id>.html.",
    };
  }
  if (!fs.existsSync(absolute)) {
    return { error: "file_not_found", file: absolute };
  }
  const linkStat = fs.lstatSync(absolute);
  if (linkStat.isSymbolicLink()) {
    return { error: "invalid_share_file", hint: "Symlinks are not accepted for share uploads." };
  }
  let realPath;
  try {
    realPath = fs.realpathSync(absolute);
  } catch {
    return { error: "file_not_found", file: absolute };
  }
  if (path.dirname(realPath) !== tmpDir || path.basename(realPath) !== basename) {
    return {
      error: "invalid_share_file",
      hint: "Share only uploads Mapick-generated reports saved as /tmp/mapick-report-<id>.html.",
    };
  }
  const stat = fs.statSync(absolute);
  if (!stat.isFile()) return { error: "invalid_share_file", hint: "Share target must be a regular file." };
  if (stat.size > 200 * 1024) {
    return { error: "share_too_large", max_bytes: 200 * 1024, actual_bytes: stat.size };
  }
  const redacted = redactForUpload(fs.readFileSync(absolute, "utf8"));
  if (!redacted.ok) return { error: redacted.error, message: redacted.message };
  return apiCall(
    "POST",
    "/share/upload",
    { reportId, html: redacted.text, locale: args[2] || "en" },
    "share",
  );
}

async function handleEvent(args, ctx) {
  // Always use the local fp; never accept userId from CLI args. Sibling
  // track commands (recommend:track / clean:track / profile-text) all
  // work this way. Letting userId flow in from ARGS was a misleading API
  // surface — the help text actively asked the AI to supply a userId —
  // and a future-footgun if the backend ever stops cross-checking the
  // x-device-fp header against body.userId.
  if (args.length < 1) {
    return missingArg("Usage: event:track <action> [skillId]");
  }
  const [actionType, metaSkillId] = args;
  if (!VALID_EVENT_ACTIONS.includes(actionType)) {
    return { error: "invalid_action", valid: VALID_EVENT_ACTIONS };
  }
  return apiCall(
    "POST",
    "/events/track",
    { userId: ctx.fp, action: actionType, skillId: metaSkillId || null },
    "event:track",
  );
}

async function handleProfile(args, ctx) {
  const sub = args[0] || "get";
  switch (sub) {
    case "set": {
      const text = args.slice(1).join(" ").trim();
      if (!text) return missingArg('Usage: profile set "<workflow text>"');
      // P0: redact before persisting to CONFIG.md — prevents secrets leak.
      const redacted = redactForUpload(text);
      if (!redacted.ok) {
        return { error: "profile_redact_failed", message: redacted.message || redacted.error };
      }
      const displayText = redacted.text;
      const tags = extractProfileTags(displayText);
      writeConfig("user_profile", displayText);
      writeConfig("user_profile_tags", JSON.stringify(tags));
      writeConfig("user_profile_set_at", isoNow());
      // POST /users/:userId/profile-text — userId in path. Local writes
      // never block on upload failure.
      let uploaded = false;
      if (!isConsentDeclined(ctx.config)) {
        const resp = await httpCall(
          "POST",
          `/users/${ctx.fp}/profile-text`,
          { profileText: displayText, profileTags: tags },
        );
        uploaded = !resp.error;
      }
      return { intent: "profile:set", profile: displayText, tags, uploaded };
    }
    case "get": {
      let tags = [];
      try {
        tags = JSON.parse(ctx.config.user_profile_tags || "[]");
      } catch {}
      return {
        intent: "profile:get",
        profile: ctx.config.user_profile || null,
        tags,
        set_at: ctx.config.user_profile_set_at || null,
      };
    }
    case "clear": {
      deleteConfig("user_profile");
      deleteConfig("user_profile_tags");
      deleteConfig("user_profile_set_at");
      // Clearing also resets first-run flag so init re-triggers the card.
      deleteConfig("first_run_complete");
      deleteConfig("first_run_at");
      return { intent: "profile:clear", cleared: true };
    }
    default:
      return {
        error: "unknown_subcommand",
        hint: "Available: set | get | clear",
      };
  }
}

function handleFirstRunDone() {
  writeConfig("first_run_complete", "true");
  writeConfig("first_run_at", isoNow());
  return { intent: "first-run-done", done: true };
}

function handleDiagnose() {
  const version = readInstalledVersion();

  const home = process.env.HOME || "";
  // shadow_risk is only real when BOTH a managed install AND a workspace copy
  // exist — only then does OpenClaw's "workspace beats managed" load order
  // silently override the managed install. A workspace-only install (the most
  // common dev path) is fine and shouldn't trip the warning.
  const managedSkillFile = path.join(
    home, ".openclaw", "skills", "mapick", "SKILL.md",
  );
  const workspaceDuplicate = path.join(
    home, ".openclaw", "workspace", "skills", "mapick",
  );
  const workspaceSkillFile = path.join(workspaceDuplicate, "SKILL.md");
  const managedExists = fs.existsSync(managedSkillFile);
  const workspaceExists = fs.existsSync(workspaceSkillFile);
  const shadowRisk = managedExists && workspaceExists;

  const skillFile = path.join(CONFIG_DIR, "SKILL.md");
  let skillMtime = null;
  try {
    skillMtime = fs.statSync(skillFile).mtime.toISOString();
  } catch {}

  return {
    intent: "diagnose",
    version,
    loaded_dir: CONFIG_DIR,
    skill_mtime: skillMtime,
    duplicate_workspace_skill: shadowRisk ? workspaceDuplicate : null,
    shadow_risk: shadowRisk,
    fix_hint: shadowRisk
      ? "Move the workspace copy outside ~/.openclaw/workspace/skills and restart the OpenClaw gateway."
      : null,
  };
}

function handleId(_args, ctx) {
  return { intent: "id", debug_identifier: ctx.fp };
}

function handleHelp() {
  return {
    intent: "help",
    text: `Mapick — node shell.js <command> [args...]

Local:    init | status | scan | summary | id | first-run-done
Diag:     diagnose | version
Skills:   recommend [limit] | recommend:track <recId> <skillId> <action>
          search <query> [limit] | intent <natural language>
          clean | clean:track <skillId>
          uninstall <skillId> [--confirm]
Reports:  workflow | daily | weekly | notify | report | share <reportId> <html> [locale]
Stats:    stats
Radar:    radar | radar:reject <category>
Bundles:  bundle [id] | bundle install <id> | bundle track-installed <id>
Security: security <skillId> | security:report <skillId> <reason> <evidence>
Privacy:  privacy {status|trust <id>|untrust <id>|delete-all --confirm
                 |consent-agree [ver]|consent-decline
                 |disable-redact|enable-redact|log [limit]}
  Events:   event:track <action> [skillId]   (always uses local device fp)
  Stats:    stats | dashboard
  Profile:  profile {set "<text>"|get|clear}`,
  };
}

function handleUnknown(_args, ctx) {
  return {
    error: "unknown_command",
    command: ctx.command,
    hint: "Run help for usage",
  };
}

async function handleStats() {
  let globalStats = {};
  try {
    const resp = await httpCall("GET", "/stats/public", null, "stats");
    if (!resp.error) globalStats = resp;
  } catch {}

  // Read local cached events from outbound audit log.
  let events = [];
  try {
    const { readOutboundLog } = require("./audit");
    events = readOutboundLog();
  } catch {}

  // Count recommendation conversion events.
  const recEvents = events.filter((e) => e.intent === "recommend:track" || e.action?.startsWith("rec_"));
  const shown = recEvents.filter((e) =>
    (e.action || e.method || "").includes("shown"),
  ).length;
  const clicks = recEvents.filter((e) =>
    (e.action || e.method || "").includes("click"),
  ).length;
  const installed = recEvents.filter((e) =>
    (e.action || e.method || "").includes("installed"),
  ).length;
  const conversionRate =
    shown > 0 ? `${Math.round((installed / shown) * 100)}%` : "—";

  // Fun fact from global stats.
  const skillsCovered = globalStats.skillsCovered || 0;
  const dailyInteractions = globalStats.dailyInteractions || 0;
  const totalInstalls = globalStats.installs || 0;
  let funFact = "Mapick 已覆盖 " + skillsCovered.toLocaleString() + " 个 skill";
  if (dailyInteractions > 0) {
    funFact +=
      "，每日活跃交互 " + dailyInteractions.toLocaleString() + " 次";
  }
  if (totalInstalls > 0) {
    funFact += "，全球 " + totalInstalls.toLocaleString() + " 次安装";
  }

  return {
    intent: "stats",
    global: {
      total_installs: totalInstalls,
      daily_interactions: dailyInteractions,
      skills_covered: skillsCovered,
    },
    local: {
      events_logged: events.length,
      rec_shown: shown,
      rec_clicked: clicks,
      rec_installed: installed,
      conversion_rate: conversionRate,
    },
    fun_fact: funFact,
  };
}

function handleDashboard() {
  const DASHBOARD_PORT = 3030;
  const url = `http://127.0.0.1:${DASHBOARD_PORT}/`;
  return {
    intent: "dashboard",
    url,
    port: DASHBOARD_PORT,
    hint: `Stats dashboard running at ${url} — open in a browser.`,
    _open_command: `open ${url}`,
  };
}

module.exports = {
  handleWorkflow, handleDaily, handleWeekly, handleNotify,
  handleBundle, handleReport, handleShare, handleEvent,
  handleProfile, handleFirstRunDone, handleDiagnose, handleId, handleHelp, handleUnknown,
  handleStats, handleDashboard,
};
