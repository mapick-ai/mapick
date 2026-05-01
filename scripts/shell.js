#!/usr/bin/env node
// Mapick skill entry point. All handlers live in lib/.
//
// Outbound HTTP audit: see lib/http.js function-doc manifest — every
// network call goes through that single httpCall function.

// Runtime preflight: bail with a structured error on Node < 22.14 (the
// OpenClaw runtime baseline) instead of letting V8 emit an opaque
// SyntaxError when newer JS features are parsed. Exit 0 matches the
// rest of this file's contract (errors are JSON-on-stdout).
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

const core = require("./lib/core");
const privacy = require("./lib/privacy");
const skills = require("./lib/skills");
const recommend = require("./lib/recommend");
const clean = require("./lib/clean");
const security = require("./lib/security");
const radar = require("./lib/radar");
const misc = require("./lib/misc");
const updates = require("./lib/updates");
const doctor = require("./lib/doctor");
const token = require("./lib/token");

const HANDLERS = {
  init: skills.handleInit,
  status: skills.handleStatus,
  scan: skills.handleScan,
  summary: skills.handleSummary,

  recommend: recommend.handleRecommend,
  "recommend:track": recommend.handleTrack,
  search: recommend.handleSearch,
  intent: recommend.handleIntent,

  clean: clean.handleClean,
  "clean:track": clean.handleTrack,
  uninstall: clean.handleUninstall,
  "backup:create": clean.handleBackupCreate,
  "backup:restore": clean.handleBackupRestore,

  security: security.handleSecurity,
  "security:report": security.handleReport,

  privacy: privacy.handle,
  "network-consent": privacy.handleNetworkConsent,

  "update:check": updates.handleCheck,
  "update:settings": updates.handleSettings,
  "update:dismissed": updates.handleDismissed,
  "update:track": updates.handleUpdateTrack,
  "upgrade:plan": updates.handleUpgradePlan,
  "notify:plan": updates.handleNotifyPlan,
  "notify:disable": updates.handleNotifyDisable,
  "notify:track": updates.handleNotifyTrack,
  "notify:status": updates.handleNotifyStatus,

  workflow: misc.handleWorkflow,
  daily: misc.handleDaily,
  weekly: misc.handleWeekly,
  notify: misc.handleNotify,
  radar: radar.handleRadar,
  "radar:reject": radar.handleRadarReject,
  bundle: misc.handleBundle,
  report: misc.handleReport,
  share: misc.handleShare,
  event: misc.handleEvent,
  "event:track": misc.handleEvent,
  stats: misc.handleStats,
  "stats token": token.handleToken,
  "stats user": misc.handleStatsUser,
  dashboard: misc.handleDashboard,
  token: token.handleToken,
  profile: misc.handleProfile,
  "first-run-done": misc.handleFirstRunDone,
  diagnose: misc.handleDiagnose,
  version: misc.handleDiagnose,
  doctor: doctor.handleDoctor,
  id: misc.handleId,
  help: misc.handleHelp,
  "--help": misc.handleHelp,
  "-h": misc.handleHelp,
};

async function main() {
  const command = process.argv[2] || "status";
  const args = process.argv.slice(3);
  const ctx = {
    command,
    args,
    config: core.readConfig(),
    fp: core.deviceFp(),
  };

  // P3: Function-level consent gate. On first network operation, prompt the
  // user before sending any data. Once consent is set (always/once/declined),
  // this gate is skipped.
  if (privacy.isRemoteCommand(command, args) && privacy.isFirstNetworkUse(ctx.config)) {
    console.log(JSON.stringify(privacy.networkConsentPrompt(ctx)));
    return;
  }

  // P3 declined gate: network_consent === "declined" blocks remote commands.
  if (privacy.isRemoteCommand(command, args) && ctx.config.network_consent === "declined") {
    console.log(JSON.stringify({
      error: "network_consent_declined",
      mode: "local_only",
      hint: "You chose local mode. Run `node scripts/shell.js network-consent always` to allow network access, or use local-only features.",
    }));
    return;
  }

  // Opt-out model: global consent_declined blocks remote commands.
  if (privacy.isRemoteCommand(command, args) && core.isConsentDeclined(ctx.config)) {
    console.log(JSON.stringify(privacy.remoteAccessError(ctx.config)));
    return;
  }

  const handler = HANDLERS[command] || misc.handleUnknown;
  const result = await handler(args, ctx);
  console.log(JSON.stringify(core.clampOutput(result)));

  // P3: "once" consent expires after one successful remote command.
  if (
    privacy.isRemoteCommand(command, args) &&
    ctx.config.network_consent === "once"
  ) {
    core.deleteConfig("network_consent");
    core.deleteConfig("network_consent_at");
  }
}

main().catch((e) => console.log(JSON.stringify({ error: e.message })));
