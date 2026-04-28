// Privacy subcommands, redaction subprocess, consent gate helpers.

const fs = require("fs");
const { execSync } = require("child_process");
const {
  CACHE_DIR, CONFIG_FILE, REDACTJS_PATH, TRASH_DIR,
  REMOTE_COMMANDS,
  isoNow, readConfig, writeConfig, deleteConfig,
  hasConsent, isConsentDeclined,
} = require("./core");
const { httpCall, missingArg } = require("./http");
const { registerNotifyCron } = require("./skills");

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

async function handle(args, ctx) {
  const subCmd = args[0] || "status";
  const config = ctx.config;
  const fp = ctx.fp;

  switch (subCmd) {
    case "status":
      return {
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

    case "trust": {
      if (args.length < 2) return missingArg("Usage: privacy trust <skillId>");
      const result = await httpCall("POST", "/users/trusted-skills", {
        userId: fp,
        skillId: args[1],
        permission: "unredacted",
      });
      result.intent = "privacy:trust";
      const trusted = config.trusted_skills
        ? config.trusted_skills.split(",")
        : [];
      trusted.push(args[1]);
      writeConfig("trusted_skills", trusted.join(","));
      return result;
    }

    case "untrust": {
      if (args.length < 2) return missingArg("Usage: privacy untrust <skillId>");
      const untrusted = (
        config.trusted_skills ? config.trusted_skills.split(",") : []
      ).filter((s) => s !== args[1]);
      writeConfig("trusted_skills", untrusted.join(","));
      return { intent: "privacy:untrust", skillId: args[1] };
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

    default:
      return {
        error: "unknown_subcommand",
        hint: "Available: status | trust | untrust | delete-all | consent-agree | consent-decline | disable-redact | enable-redact",
      };
  }
}

module.exports = { handle, isRemoteCommand, remoteAccessError, redact };
