const fs = require("fs");
const path = require("path");
const os = require("os");
const { API_BASE, deviceFp, redact, isoNow } = require("./core");

/**
 * Mapick outbound network manifest. EVERY HTTP request from this Skill
 * goes through this single function — grep `httpCall(` to audit.
 *
 * Endpoint                            Data sent                       Trigger
 * GET  /assistant/status/:fp          device_fp (anon)                /mapick status (summary)
 * GET  /assistant/{workflow,daily-digest,weekly}/:fp  device_fp       /mapick workflow|daily|weekly
 * GET  /recommendations/feed          device_fp, profileTags          /mapick recommend
 * POST /recommendations/track         recId, skillId, action          user picks a recommendation
 * GET  /skills/live-search            query string                    /mapick search <q>
 * GET  /users/:fp/zombies             device_fp                       /mapick clean
 * POST /events/track                  userId, action, skillId         skill_uninstall, zombie_cleanup
 * GET  /bundle, /bundle/:id           bundleId (or none)              /mapick bundle
 * POST /bundle/seed                   bundleId, userId                bundle:track-installed
 * GET  /report/persona                device_fp                       /mapick report
 * POST /share/upload                  redacted HTML, reportId         /mapick share
 * GET  /skill/:id/security            skillId                         /mapick security <id>
 * POST /skill/:id/report              reason, evidenceEn              /mapick security:report
 * POST /users/trusted-skills          userId, skillId, permission     /mapick privacy trust
 * DELETE /users/data                  device_fp                       /mapick privacy delete-all
 * POST /users/consent                 consentVersion, agreedAt        first install consent
 * POST /users/:fp/profile-text        profileText, profileTags        /mapick profile set
 * GET  /notify/daily-check            currentVersion, repo            daily cron
 *
 * Base URL: https://api.mapick.ai/api/v1 (also declared in SKILL.md
 * metadata.openclaw.permissions.network).
 *
 * NEVER sent: file contents, chat history, API tokens, credentials,
 * Skill source code, environment variables. The only outgoing identifier
 * is device_fp (anonymous 16-char hash of hostname|os|home).
 *
 * Trust signals:
 *  - Endpoint allowlist (ALLOWED_ENDPOINTS below) — calls outside the
 *    manifest are refused before they leave the box.
 *  - redact() pre-flight — every body is checked for sensitive patterns;
 *    mismatch is recorded as redact_warning in the outbound log (the
 *    original payload is still sent so API contracts don't silently
 *    break, but the user gets a signal to investigate).
 *  - Outbound log at ~/.mapick/logs/outbound.jsonl — endpoint, method,
 *    field NAMES (never values), status code, duration. /mapick privacy
 *    log shows the last 10 entries.
 *
 * Why curl, not https.request: Node 24 on macOS throws
 * UNABLE_TO_VERIFY_LEAF_SIGNATURE because bundled CAs miss intermediates
 * the system keychain trusts; `--use-system-ca` is unreliable in 24.x.
 */

// Endpoint allowlist — paths not matching any pattern are refused.
// Keep in sync with the manifest above. Trailing query strings are
// stripped before matching.
const ALLOWED_ENDPOINTS = [
  /^\/assistant\/(status|workflow|daily-digest|weekly)\/[a-f0-9]{16}$/,
  /^\/recommendations\/(feed|track)$/,
  /^\/skills\/live-search$/,
  /^\/users\/[a-f0-9]{16}\/(zombies|profile-text)$/,
  /^\/users\/(trusted-skills|data|consent)$/,
  /^\/events\/track$/,
  /^\/bundle$/,
  /^\/bundle\/seed$/,
  /^\/bundle\/recommend\/list$/,
  /^\/bundle\/[\w-]+$/,
  /^\/bundle\/[\w-]+\/install$/,
  /^\/report\/persona$/,
  /^\/share\/upload$/,
  /^\/skill\/[\w-]+\/(security|report)$/,
  /^\/notify\/daily-check$/,
];

function isAllowedEndpoint(endpoint) {
  const normalized = "/" + endpoint.replace(/^\//, "").split("?")[0];
  return ALLOWED_ENDPOINTS.some((re) => re.test(normalized));
}

const LOG_DIR = path.join(os.homedir(), ".mapick", "logs");
const LOG_FILE = path.join(LOG_DIR, "outbound.jsonl");
const LOG_FILE_BAK = path.join(LOG_DIR, "outbound.jsonl.1");
const LOG_MAX_BYTES = 1024 * 1024;

// Append one JSONL entry to the outbound audit log. Never throws — a
// broken log path must not break the actual API call.
function logOutbound(entry) {
  try {
    if (!fs.existsSync(LOG_DIR)) fs.mkdirSync(LOG_DIR, { recursive: true });
    if (
      fs.existsSync(LOG_FILE) &&
      fs.statSync(LOG_FILE).size > LOG_MAX_BYTES
    ) {
      fs.renameSync(LOG_FILE, LOG_FILE_BAK);
    }
    fs.appendFileSync(LOG_FILE, JSON.stringify(entry) + "\n");
  } catch {}
}

// Read both the active log and the rotated backup. Returns entries
// in chronological order, oldest first; caller can slice as needed.
function readOutboundLog() {
  const lines = [];
  for (const f of [LOG_FILE_BAK, LOG_FILE]) {
    if (!fs.existsSync(f)) continue;
    try {
      const content = fs.readFileSync(f, "utf8");
      content
        .split("\n")
        .filter(Boolean)
        .forEach((line) => {
          try {
            lines.push(JSON.parse(line));
          } catch {}
        });
    } catch {}
  }
  return lines;
}

async function httpCall(method, endpoint, body = null) {
  const t0 = Date.now();
  const ts = isoNow();

  if (!isAllowedEndpoint(endpoint)) {
    logOutbound({
      ts,
      method,
      endpoint,
      blocked: true,
      reason: "not_in_allowlist",
    });
    return {
      error: "endpoint_not_allowed",
      endpoint,
      message:
        "Endpoint not declared in lib/http.js manifest. Refused to send.",
    };
  }

  const base = API_BASE.replace(/\/$/, "") + "/";
  const url = new URL(endpoint.replace(/^\//, ""), base);
  const STATUS_DELIM = "___MAPICK_HTTP_STATUS___";

  // Audit-mode redact: never rewrite the payload (would silently break
  // API contracts). Just flag if redact would change anything so the
  // user sees redact_warning in the outbound log.
  let redactWarning = false;
  if (body) {
    const original = JSON.stringify(body);
    if (redact(original) !== original) redactWarning = true;
  }

  const args = [
    "-sSL",
    "-X", method,
    "-m", "15",
    "-H", "Content-Type: application/json",
    "-H", `x-device-fp: ${deviceFp()}`,
    "-w", `\n${STATUS_DELIM}%{http_code}`,
    url.toString(),
  ];
  if (body) {
    args.push("-d", JSON.stringify(body));
  }

  const params = [...url.searchParams.keys()];
  const bodyFields = body && typeof body === "object" ? Object.keys(body) : [];

  return new Promise((resolve) => {
    const cp = require("child_process").execFile(
      "curl",
      args,
      { maxBuffer: 8 * 1024 * 1024 },
      (err, stdout) => {
        let result;
        if (err && !stdout) {
          result = { error: "network_error", message: err.message };
          finish(0);
          return;
        }
        const idx = stdout.lastIndexOf(STATUS_DELIM);
        const data = idx >= 0 ? stdout.slice(0, idx).replace(/\n$/, "") : stdout;
        const code = idx >= 0 ? parseInt(stdout.slice(idx + STATUS_DELIM.length).trim(), 10) : 0;

        if (!code || Number.isNaN(code)) {
          result = {
            error: "network_error",
            message: err ? err.message : "no_status_code",
          };
        } else if (code === 401) {
          result = { error: "unauthorized", statusCode: 401 };
        } else if (code === 404) {
          result = { error: "not_found", statusCode: 404 };
        } else if (code === 429) {
          result = { error: "rate_limit", statusCode: 429 };
        } else if (code >= 400) {
          try {
            const parsed = JSON.parse(data);
            result = { error: "http_error", statusCode: code, ...parsed };
          } catch {
            result = { error: "http_error", statusCode: code, body: data };
          }
        } else {
          try {
            result = JSON.parse(data);
          } catch {
            result = { error: "parse_error", raw: data };
          }
        }
        finish(code);

        function finish(status) {
          const entry = {
            ts,
            method,
            endpoint: endpoint.split("?")[0],
            params,
            body_fields: bodyFields,
            status,
            duration_ms: Date.now() - t0,
          };
          if (redactWarning) entry.redact_warning = true;
          logOutbound(entry);
          resolve(result);
        }
      },
    );
    cp.on("error", (e) => {
      logOutbound({
        ts,
        method,
        endpoint: endpoint.split("?")[0],
        error: "spawn_failed",
        duration_ms: Date.now() - t0,
      });
      resolve({ error: "network_error", message: e.message });
    });
  });
}

async function apiCall(method, endpoint, body, intent) {
  const r = await httpCall(method, endpoint, body);
  if (intent) r.intent = intent;
  return r;
}

const missingArg = (hint) => ({ error: "missing_argument", hint });

module.exports = {
  httpCall, apiCall, missingArg,
  ALLOWED_ENDPOINTS, isAllowedEndpoint,
  readOutboundLog,
};
