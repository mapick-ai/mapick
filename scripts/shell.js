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
const misc = require("./lib/misc");
const updates = require("./lib/updates");

const HANDLERS = {
  init: skills.handleInit,
  status: skills.handleInit,
  scan: skills.handleScan,
  summary: skills.handleSummary,

  recommend: recommend.handleRecommend,
  "recommend:track": recommend.handleTrack,
  search: recommend.handleSearch,

  clean: clean.handleClean,
  "clean:track": clean.handleTrack,
  uninstall: clean.handleUninstall,
  "backup:create": clean.handleBackupCreate,
  "backup:restore": clean.handleBackupRestore,

  security: security.handleSecurity,
  "security:report": security.handleReport,

  privacy: privacy.handle,

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
  bundle: misc.handleBundle,
  report: misc.handleReport,
  share: misc.handleShare,
  event: misc.handleEvent,
  "event:track": misc.handleEvent,
  profile: misc.handleProfile,
  "first-run-done": misc.handleFirstRunDone,
  diagnose: misc.handleDiagnose,
  version: misc.handleDiagnose,
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

  // Opt-out model: data flows by default. Only block remote commands when
  // the user has explicitly run `privacy consent-decline`. New installs
  // skip the consent gate entirely.
  if (privacy.isRemoteCommand(command, args) && core.isConsentDeclined(ctx.config)) {
    console.log(JSON.stringify(privacy.remoteAccessError(ctx.config)));
    return;
  }

  const handler = HANDLERS[command] || misc.handleUnknown;
  const result = await handler(args, ctx);
  console.log(JSON.stringify(core.clampOutput(result)));
}

main().catch((e) => console.log(JSON.stringify({ error: e.message })));
