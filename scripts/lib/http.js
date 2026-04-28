const { API_BASE, deviceFp } = require("./core");

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
 * Why curl, not https.request: Node 24 on macOS throws
 * UNABLE_TO_VERIFY_LEAF_SIGNATURE because bundled CAs miss intermediates
 * the system keychain trusts; `--use-system-ca` is unreliable in 24.x.
 */
async function httpCall(method, endpoint, body = null) {
  const base = API_BASE.replace(/\/$/, "") + "/";
  const url = new URL(endpoint.replace(/^\//, ""), base);
  const STATUS_DELIM = "___MAPICK_HTTP_STATUS___";

  // %{http_code} after a unique delimiter so JSON newlines don't confuse parsing.
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

  return new Promise((resolve) => {
    const cp = require("child_process").execFile(
      "curl",
      args,
      { maxBuffer: 8 * 1024 * 1024 },
      (err, stdout) => {
        if (err && !stdout) {
          resolve({ error: "network_error", message: err.message });
          return;
        }
        const idx = stdout.lastIndexOf(STATUS_DELIM);
        const data = idx >= 0 ? stdout.slice(0, idx).replace(/\n$/, "") : stdout;
        const code = idx >= 0 ? parseInt(stdout.slice(idx + STATUS_DELIM.length).trim(), 10) : 0;

        if (!code || Number.isNaN(code)) {
          resolve({
            error: "network_error",
            message: err ? err.message : "no_status_code",
          });
        } else if (code === 401) {
          resolve({ error: "unauthorized", statusCode: 401 });
        } else if (code === 404) {
          resolve({ error: "not_found", statusCode: 404 });
        } else if (code === 429) {
          resolve({ error: "rate_limit", statusCode: 429 });
        } else if (code >= 400) {
          try {
            const parsed = JSON.parse(data);
            resolve({ error: "http_error", statusCode: code, ...parsed });
          } catch {
            resolve({ error: "http_error", statusCode: code, body: data });
          }
        } else {
          try {
            resolve(JSON.parse(data));
          } catch {
            resolve({ error: "parse_error", raw: data });
          }
        }
      },
    );
    cp.on("error", (e) =>
      resolve({ error: "network_error", message: e.message }),
    );
  });
}

async function apiCall(method, endpoint, body, intent) {
  const r = await httpCall(method, endpoint, body);
  if (intent) r.intent = intent;
  return r;
}

const missingArg = (hint) => ({ error: "missing_argument", hint });

module.exports = { httpCall, apiCall, missingArg };
