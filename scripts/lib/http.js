const fs = require("fs");
const path = require("path");
const os = require("os");
const http = require("http");
const https = require("https");
const { API_BASE, deviceFp, redactForUpload, isoNow } = require("./core");

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
 * POST /share/upload                  redacted generated report HTML  /mapick share
 * GET  /skill/:id/security            skillId                         /mapick security <id>
 * POST /skill/:id/report              reason, evidenceEn              /mapick security:report
 * POST /users/trusted-skills          userId, skillId, permission     /mapick privacy trust
 * DELETE /users/data                  device_fp                       /mapick privacy delete-all
 * POST /users/consent                 consentVersion, agreedAt        first install consent
 * POST /users/:fp/profile-text        redacted profileText, tags      /mapick profile set
 * GET  /notify/daily-check            currentVersion, repo            daily cron
 *
 * Base URL: see API_BASE in lib/core.js. Production is
 * https://api.mapick.ai/api/v1 (also declared in SKILL.md
 * metadata.openclaw.permissions.network). Local test builds may temporarily
 * use http://127.0.0.1:3010/api/v1 and must be reverted before publishing.
 *
 * NEVER sent: arbitrary local file contents, chat history, API tokens,
 * credentials, Skill source code, environment variables. The only outgoing
 * identifier is device_fp (anonymous 16-char hash of hostname|os|home).
 * Share uploads are restricted to Mapick-generated
 * /tmp/mapick-report-<id>.html files after fail-closed redaction.
 *
 * Trust signals:
 *  - Endpoint allowlist (ALLOWED_ENDPOINTS below) — calls outside the
 *    manifest are refused before they leave the box.
 *  - redact() pre-flight — every body is checked for sensitive patterns.
 *    Redaction unavailable => refused. Sensitive-looking values => only
 *    the redacted JSON body is sent and redacted_payload is logged.
 *  - Outbound log at ~/.mapick/logs/outbound.jsonl — endpoint, method,
 *    field NAMES (never values), status code, duration. /mapick privacy
 *    log shows the last 10 entries.
 *
 * Uses Node's built-in fetch with a 15s AbortController timeout.
 */

// Endpoint allowlist — paths not matching any pattern are refused.
// Keep in sync with the manifest above. Trailing query strings are
// stripped before matching.
const ALLOWED_ENDPOINTS = [
  /^\/assistant\/(status|workflow|daily-digest|weekly)\/[a-f0-9]{16}$/,
  /^\/recommendations\/(feed|track)$/,
  /^\/skills\/live-search$/,
  /^\/skills\/check-updates$/,
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

// Audit-log read side lives in lib/audit.js — keeps file reads out
// of the module that performs network sends.

// Classify a fetch / Node TLS error into a coarse category so callers
// (notably `doctor`) can show actionable guidance instead of a raw `cause.code`.
//
// Categories:
//   dns  — name not resolved (EAI_AGAIN, ENOTFOUND, DNS server unreachable)
//   tcp  — TCP connect failed (ECONNREFUSED, ETIMEDOUT, EHOSTUNREACH, ECONNRESET)
//   tls  — certificate or handshake failed (UNABLE_TO_VERIFY_LEAF_SIGNATURE,
//          CERT_HAS_EXPIRED, DEPTH_ZERO_SELF_SIGNED_CERT, …)
//   abort — request was aborted (15s timeout via AbortController)
//   unknown — anything we couldn't pin down
//
// `proxy` and `unhealthy_payload` are determined at the response layer (HTTP
// status / body shape), not from a fetch exception, so they're not produced here.
function classifyFetchError(err) {
  const code = err?.cause?.code || err?.code || "";
  const msg = err?.message || "";

  if (err?.name === "AbortError" || /aborted/i.test(msg)) return "abort";

  if (
    code === "EAI_AGAIN" ||
    code === "ENOTFOUND" ||
    /getaddrinfo/i.test(msg)
  ) return "dns";

  if (
    code === "ECONNREFUSED" ||
    code === "ETIMEDOUT" ||
    code === "EHOSTUNREACH" ||
    code === "ENETUNREACH" ||
    code === "ECONNRESET"
  ) return "tcp";

  if (
    code === "UNABLE_TO_VERIFY_LEAF_SIGNATURE" ||
    code === "CERT_HAS_EXPIRED" ||
    code === "DEPTH_ZERO_SELF_SIGNED_CERT" ||
    code === "SELF_SIGNED_CERT_IN_CHAIN" ||
    code === "ERR_TLS_CERT_ALTNAME_INVALID" ||
    code === "CERT_NOT_YET_VALID" ||
    /certificate|tls handshake|ssl/i.test(msg)
  ) return "tls";

  return "unknown";
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

  let redactedPayload = false;
  for (const [key, value] of url.searchParams.entries()) {
    if (!value) continue;
    const redacted = redactForUpload(value);
    if (!redacted.ok) {
      logOutbound({
        ts,
        method,
        endpoint: endpoint.split("?")[0],
        blocked: true,
        reason: redacted.error,
        params: [...url.searchParams.keys()],
      });
      return { error: redacted.error, message: redacted.message };
    }
    if (redacted.text !== value) {
      redactedPayload = true;
      url.searchParams.set(key, redacted.text);
    }
  }

  // Fail closed when redaction is unavailable. If sensitive-looking values
  // are present, send only the redacted JSON body and record that fact.
  let bodyToSend = body;
  if (body) {
    const original = JSON.stringify(body);
    const redacted = redactForUpload(original);
    if (!redacted.ok) {
      logOutbound({
        ts,
        method,
        endpoint: endpoint.split("?")[0],
        blocked: true,
        reason: redacted.error,
      });
      return { error: redacted.error, message: redacted.message };
    }
    if (redacted.text !== original) {
      redactedPayload = true;
      try {
        bodyToSend = JSON.parse(redacted.text);
      } catch {
        logOutbound({
          ts,
          method,
          endpoint: endpoint.split("?")[0],
          blocked: true,
          reason: "redaction_parse_failed",
        });
        return { error: "redaction_parse_failed" };
      }
    }
  }

  const params = [...url.searchParams.keys()];
  const bodyFields = body && typeof body === "object" ? Object.keys(body) : [];

  let status = 0;
  let result;
  try {
    const response = await requestJson(url, method, bodyToSend);
    status = response.status;
    const data = response.body;
    if (status >= 400) {
      const stableErrors = { 401: "unauthorized", 404: "not_found", 429: "rate_limit" };
      const errCode = stableErrors[status] || "http_error";
      try {
        const parsed = JSON.parse(data);
        result = { error: errCode, statusCode: status, ...parsed };
      } catch {
        result = { error: errCode, statusCode: status, body: data };
      }
    } else {
      try {
        result = JSON.parse(data);
      } catch {
        result = { error: "parse_error", raw: data };
      }
    }
  } catch (err) {
    result = {
      error: "network_error",
      class: classifyFetchError(err),
      message: err.message,
      cause_code: err.cause?.code,
    };
  } finally {
    const entry = {
      ts,
      method,
      endpoint: endpoint.split("?")[0],
      params,
      body_fields: bodyFields,
      status,
      duration_ms: Date.now() - t0,
    };
    if (redactedPayload) entry.redacted_payload = true;
    logOutbound(entry);
  }
  return result;
}

function requestJson(url, method, body) {
  return new Promise((resolve, reject) => {
    const payload = body ? JSON.stringify(body) : null;
    const transport = url.protocol === "http:" ? http : https;
    const req = transport.request(url, {
      method,
      headers: {
        "Content-Type": "application/json",
        "x-device-fp": deviceFp(),
        ...(payload ? { "Content-Length": Buffer.byteLength(payload) } : {}),
      },
      timeout: 15000,
    }, (res) => {
      let data = "";
      res.setEncoding("utf8");
      res.on("data", (chunk) => {
        data += chunk;
      });
      res.on("end", () => {
        resolve({ status: res.statusCode || 0, body: data });
      });
    });
    req.on("timeout", () => {
      req.destroy(new Error("request_timeout"));
    });
    req.on("error", reject);
    if (payload) req.write(payload);
    req.end();
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
  ALLOWED_ENDPOINTS, isAllowedEndpoint, classifyFetchError,
};
