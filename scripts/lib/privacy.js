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

// P3: Function-level consent — first network operation triggers a prompt.
// Returns true when the user has never set network_consent AND has never
// explicitly declined global consent. The prompt is a one-time gate.
function isFirstNetworkUse(config) {
  // If user already chose always or once, no prompt needed.
  if (config.network_consent === "always") return false;
  if (config.network_consent === "once") return false;
  // If user explicitly declined globally, handled by isConsentDeclined gate.
  if (config.network_consent === "declined") return false;
  // No preference set → first network use.
  return true;
}

function networkConsentPrompt(_ctx) {
  return {
    intent: "network_consent_required",
    message: "为了推荐 skill，Mapick 会发送：匿名设备 ID、已安装 skill 名称、搜索关键词。不会发送聊天全文、API key、文件内容。允许这次搜索吗？",
    messageEn: "To recommend skills, Mapick will send: anonymous device ID, installed skill names, search keywords. Chat content, API keys, and file contents are NEVER sent. Allow this search?",
    options: [
      { id: "always", label: "允许并记住", labelEn: "Allow and remember" },
      { id: "once", label: "仅这一次", labelEn: "Just this once" },
      { id: "declined", label: "本地模式", labelEn: "Local mode" },
    ],
    // The AI should re-run the original command after setting consent.
  };
}

async function handleNetworkConsent(args) {
  const choice = args[0];
  if (!["always", "once", "declined"].includes(choice)) {
    return { error: "invalid_choice", valid: ["always", "once", "declined"] };
  }
  writeConfig("network_consent", choice);
  writeConfig("network_consent_at", isoNow());
  if (choice === "declined") {
    return {
      intent: "network_consent",
      choice: "declined",
      mode: "local_only",
      hint: "Remote commands disabled. Use `node scripts/shell.js privacy consent-agree` to resume, or `node scripts/shell.js network-consent always` to allow.",
    };
  }
  return {
    intent: "network_consent",
    choice,
    hint: choice === "once"
      ? "This command will run, then you'll be prompted again next time."
      : "All future network operations will proceed without prompting.",
    // Tell the AI to re-run the original command.
    retry_original_command: true,
  };
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
      }, "privacy:trust");
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
      if (args.length < 2 || !args[1]) return missingArg("Usage: privacy untrust <skillId>");
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
      const deleteResp = await httpCall("DELETE", "/users/data", null, "privacy:delete-all");
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
      }, "privacy:consent-agree");
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
      // Restore default network access so remote commands are unblocked
      writeConfig("network_consent", "always");
      writeConfig("network_consent_at", now);
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

    case "network-consent":
      return handleNetworkConsent(args.slice(1));

    default:
      return {
        error: "unknown_subcommand",
        hint: "Available: status | trust | untrust | delete-all | consent-agree | consent-decline | disable-redact | enable-redact | log",
      };
  }
}

module.exports = {
  handle,
  handleNetworkConsent,
  isRemoteCommand,
  isFirstNetworkUse,
  networkConsentPrompt,
  remoteAccessError,
};
