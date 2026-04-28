#!/usr/bin/env node
// Mapick skill entry point. All handlers live in lib/.
//
// Outbound HTTP audit: see lib/http.js function-doc manifest — every
// network call goes through that single httpCall function.

const core = require("./lib/core");
const privacy = require("./lib/privacy");
const skills = require("./lib/skills");
const recommend = require("./lib/recommend");
const clean = require("./lib/clean");
const security = require("./lib/security");
const misc = require("./lib/misc");

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

  security: security.handleSecurity,
  "security:report": security.handleReport,

  privacy: privacy.handle,

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

  if (
    privacy.isRemoteCommand(command, args) &&
    (!core.hasConsent(ctx.config) || core.isConsentDeclined(ctx.config))
  ) {
    console.log(JSON.stringify(privacy.remoteAccessError(ctx.config)));
    return;
  }

  const handler = HANDLERS[command] || misc.handleUnknown;
  const result = await handler(args, ctx);
  console.log(JSON.stringify(core.clampOutput(result)));
}

main().catch((e) => console.log(JSON.stringify({ error: e.message })));
