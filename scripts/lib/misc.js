// Bundle, persona report, share, profile, workflow/daily/weekly/notify/event,
// first-run-done, id, help, unknown — all the small handlers.

const fs = require("fs");
const path = require("path");
const {
  CONFIG_DIR, OUT_ARR, VALID_EVENT_ACTIONS,
  isoNow, extractProfileTags, redact,
  writeConfig, deleteConfig,
  hasConsent, isConsentDeclined,
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
  return apiCall(
    "GET",
    `/assistant/daily-digest/${ctx.fp}?compact=1`,
    null,
    "daily",
  );
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
  if (resp.error) return { intent: "notify", alerts: [] };
  return { intent: "notify", ...resp };
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
  if (sub === "install" && args[1]) {
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

async function handleReport() {
  const reportResp = await httpCall("GET", `/report/persona?compact=1`);
  const result = { intent: "report", ...reportResp };
  if (
    result.status === "brewing" ||
    result.primaryPersona?.id === "fresh_meat"
  ) {
    result.status = result.status || "brewing";
    result.messageEn =
      result.messageEn ||
      ":lock: Your persona is brewing. Use Mapick for a few more skill actions before generating a shareable report.";
  }
  return result;
}

async function handleShare(args) {
  if (args.length < 2) return missingArg("Usage: share <reportId> <htmlFile>");
  const [reportId, htmlFile] = args;
  if (!fs.existsSync(htmlFile)) {
    return { error: "file_not_found", file: htmlFile };
  }
  const htmlContent = redact(fs.readFileSync(htmlFile, "utf8"));
  return apiCall(
    "POST",
    "/share/upload",
    { reportId, html: htmlContent, locale: args[2] || "en" },
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
      const tags = extractProfileTags(text);
      writeConfig("user_profile", text);
      writeConfig("user_profile_tags", JSON.stringify(tags));
      writeConfig("user_profile_set_at", isoNow());
      // POST /users/:userId/profile-text — userId in path. Local writes
      // never block on upload failure.
      let uploaded = false;
      if (hasConsent(ctx.config) && !isConsentDeclined(ctx.config)) {
        const resp = await httpCall(
          "POST",
          `/users/${ctx.fp}/profile-text`,
          { profileText: text, profileTags: tags },
        );
        uploaded = !resp.error;
      }
      return { intent: "profile:set", profile: text, tags, uploaded };
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

function handleId(_args, ctx) {
  return { intent: "id", debug_identifier: ctx.fp };
}

function handleHelp() {
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
                 |disable-redact|enable-redact|log [limit]}
Events:   event:track <action> [skillId]   (always uses local device fp)
Profile:  profile {set "<text>"|get|clear}`);
  return { error: "usage" };
}

function handleUnknown(_args, ctx) {
  return {
    error: "unknown_command",
    command: ctx.command,
    hint: "Run help for usage",
  };
}

module.exports = {
  handleWorkflow, handleDaily, handleWeekly, handleNotify,
  handleBundle, handleReport, handleShare, handleEvent,
  handleProfile, handleFirstRunDone, handleId, handleHelp, handleUnknown,
};
