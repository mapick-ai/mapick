// Privacy subcommands and consent gate helpers.

const fs = require("fs");
const {
  CACHE_DIR, CONFIG_FILE, TRASH_DIR,
  REMOTE_COMMANDS,
  isoNow, writeConfig, deleteConfig,
  isConsentDeclined,
} = require("./core");
const { httpCall, missingArg } = require("./http");
const { readOutboundLog } = require("./audit");
const { registerNotifyCron } = require("./skills");

function isRemoteCommand(command, args) {
  if (REMOTE_COMMANDS.has(command)) return true;
  if (command === "bundle") return true;
  if (command === "privacy" && ["trust"].includes(args[0])) return true;
  return false;
}

function remoteAccessError(_config) {
  // Only reached when isConsentDeclined === true; the new-install consent
  // gate is gone (opt-out model).
  return {
    error: "disabled_in_local_mode",
    mode: "local_only",
    hint: "You opted out earlier. Run `node scripts/shell.js privacy consent-agree` to resume — same anonymous flow new installs are on.",
  };
}

async function handle(args, ctx) {
  const subCmd = args[0] || "status";
  const config = ctx.config;
  const fp = ctx.fp;

  switch (subCmd) {
    case "status":
      return {
        intent: "privacy:status",
        mode:
          config.consent_declined === "true"
            ? "local_only"
            : "default_on",
        consent_version: config.consent_version || null,
        consent_agreed_at: config.consent_agreed_at || null,
        consent_declined: config.consent_declined === "true",
        remote_access:
          config.consent_declined === "true"
            ? "local_only"
            : "enabled",
        trusted_skills: config.trusted_skills
          ? config.trusted_skills.split(",")
          : [],
        redact_disabled: config.redact_disabled === "true",
      };

    case "trust": {
      if (args.length < 2) return missingArg("Usage: privacy trust <skillId>");
      const result = await httpCall("POST", "/users/trusted-skills", {
        userId: fp,
        skillId: args[1],
        permission: "unredacted",
      });
      result.intent = "privacy:trust";
      if (result.error) return result;
      const trusted = config.trusted_skills
        ? config.trusted_skills.split(",")
        : [];
      if (!trusted.includes(args[1])) trusted.push(args[1]);
      writeConfig("trusted_skills", trusted.filter(Boolean).join(","));
      return result;
    }

    case "untrust": {
      if (args.length < 2) return missingArg("Usage: privacy untrust <skillId>");
      const untrusted = (
        config.trusted_skills ? config.trusted_skills.split(",") : []
      ).filter((s) => s !== args[1]);
      writeConfig("trusted_skills", untrusted.join(","));
      return {
        intent: "privacy:untrust",
        skillId: args[1],
        scope: "local",
        note: "Backend revoke endpoint is not available in this client; local trust is removed.",
      };
    }

    case "delete-all": {
      if (!args.includes("--confirm")) {
        return {
          error: "confirm_required",
          destructive_scope:
            "local CONFIG.md + cache + trash + backend data (events, skill records, consents, trusted skills, recommendation feedback, share reports)",
        };
      }
      const deleteResp = await httpCall("DELETE", "/users/data");
      if (deleteResp && deleteResp.error) {
        return {
          intent: "privacy:delete-all",
          backendCleared: false,
          localCleared: false,
          backendResponse: deleteResp,
          hint: "Backend data was not deleted, so local state was preserved. Retry when the network/API is healthy.",
        };
      }
      fs.rmSync(CONFIG_FILE, { force: true });
      fs.rmSync(CACHE_DIR, { recursive: true, force: true });
      fs.rmSync(TRASH_DIR, { recursive: true, force: true });
      const preservedFp = config.device_fp;
      fs.writeFileSync(
        CONFIG_FILE,
        `# Mapick Configuration\n# Auto-generated\n\ndevice_fp: ${preservedFp}\n`,
      );
      return {
        intent: "privacy:delete-all",
        backendCleared: true,
        localCleared: true,
        backendResponse: deleteResp,
      };
    }

    case "consent-agree": {
      // Only write local state on backend success — otherwise local "agreed"
      // would diverge from server, leaving later ConsentGuard calls 403ing.
      const version = args[1] || "1.0";
      const now = isoNow();
      const resp = await httpCall("POST", "/users/consent", {
        consentVersion: version,
        agreedAt: now,
      });
      if (resp && resp.error) {
        return {
          intent: "privacy:consent-agree",
          error: "backend_consent_failed",
          backend_error: resp.error,
          backend_message: resp.message ?? null,
          backend_status: resp.statusCode ?? null,
          hint: "Backend did not record your consent. Check your network / API base URL, then retry.",
        };
      }
      writeConfig("consent_version", version);
      writeConfig("consent_agreed_at", now);
      deleteConfig("consent_declined");
      deleteConfig("consent_declined_at");
      // Cron failure is non-fatal — consent itself already succeeded.
      const cronResult = registerNotifyCron();
      return {
        intent: "privacy:consent-agree",
        version,
        agreedAt: now,
        consentId: resp?.consentId ?? null,
        notifyCron: cronResult,
      };
    }

    case "consent-decline": {
      const declinedAt = isoNow();
      writeConfig("consent_declined", "true");
      writeConfig("consent_declined_at", declinedAt);
      return {
        intent: "privacy:consent-decline",
        mode: "local_only",
        declinedAt,
      };
    }

    case "disable-redact":
      writeConfig("redact_disabled", "true");
      writeConfig("redact_disabled_at", isoNow());
      return {
        intent: "privacy:disable-redact",
        status: "disabled",
        warning: "Sensitive data will be passed AS-IS",
      };

    case "enable-redact":
      deleteConfig("redact_disabled");
      deleteConfig("redact_disabled_at");
      return { intent: "privacy:enable-redact", status: "enabled" };

    case "log": {
      const limit = Math.min(parseInt(args[1]) || 10, 50);
      const all = readOutboundLog();
      return {
        intent: "privacy:log",
        entries: all.slice(-limit).reverse(),
        total: all.length,
        log_file: "~/.mapick/logs/outbound.jsonl",
      };
    }

    default:
      return {
        error: "unknown_subcommand",
        hint: "Available: status | trust | untrust | delete-all | consent-agree | consent-decline | disable-redact | enable-redact | log",
      };
  }
}

module.exports = { handle, isRemoteCommand, remoteAccessError };
