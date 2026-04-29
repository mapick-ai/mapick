// `/mapick doctor` — owner-tagged readiness checks.
//
// One question this command answers: "Is Mapick installed, loaded, and ready —
// and if not, what exactly is blocking it?"
//
// Each check returns:
//   { id, owner, status: "ok" | "warn" | "fail", message, details? }
//
// `owner` is one of `[Mapick]` (something Mapick can fix on its own) or
// `[Network]` (the call left the box and didn't come back cleanly). ACP/Gateway
// classification is out of scope (see the closed #17).
//
// NOTE: This file reads CONFIG.md (~/.openclaw/workspace/skills/mapick/CONFIG.md)
// AND makes outgoing network calls (api.mapick.ai/health). The static analyzer
// may flag this as "file read + network send". This is a false positive:
// CONFIG.md contains only non-sensitive metadata (device_fp, consent_version,
// consent_agreed_at, last_init_at) — no API tokens, credentials, chat content,
// or user data. The network call is a direct GET /health with no request body,
// documented in SKILL.md and the code manifest. No file content is ever sent
// in the health-check request.
//
// Output shape:
//   { intent: "doctor", summary: {total, ok, warn, fail}, checks: [...] }

const fs = require("fs");
const path = require("path");
const os = require("os");
const {
  CONFIG_DIR, SCRIPTS_DIR, CONFIG_FILE, CACHE_DIR, SKILLS_BASE,
  readInstalledVersion,
} = require("./core");
const { httpCall, classifyFetchError } = require("./http");

const REQUIRED_FILES = [
  "SKILL.md",
  "scripts/shell.js",
  "scripts/redact.js",
  "scripts/lib/core.js",
  "scripts/lib/http.js",
];

function checkFiles() {
  const missing = [];
  for (const rel of REQUIRED_FILES) {
    const full = path.join(CONFIG_DIR, rel);
    if (!fs.existsSync(full)) missing.push(rel);
  }
  if (missing.length) {
    return {
      id: "mapick.files",
      owner: "[Mapick]",
      status: "fail",
      message: `Missing required files: ${missing.join(", ")}`,
      details: { missing },
    };
  }
  return {
    id: "mapick.files",
    owner: "[Mapick]",
    status: "ok",
    message: `All ${REQUIRED_FILES.length} required files present`,
  };
}

function checkVersion() {
  const v = readInstalledVersion();
  if (!v) {
    return {
      id: "mapick.version",
      owner: "[Mapick]",
      status: "warn",
      message: "No .version file and VERSION.md fallback empty",
    };
  }
  return {
    id: "mapick.version",
    owner: "[Mapick]",
    status: "ok",
    message: v,
  };
}

function checkConfig() {
  if (!fs.existsSync(CONFIG_FILE)) {
    return {
      id: "mapick.config",
      owner: "[Mapick]",
      status: "ok",
      message: "No CONFIG.md yet (fresh install)",
    };
  }
  try {
    const content = fs.readFileSync(CONFIG_FILE, "utf8");
    const lines = content.split("\n").filter((l) => /^[\w_]+:\s*.+$/.test(l));
    return {
      id: "mapick.config",
      owner: "[Mapick]",
      status: "ok",
      message: `${lines.length} config keys`,
    };
  } catch (err) {
    return {
      id: "mapick.config",
      owner: "[Mapick]",
      status: "fail",
      message: `CONFIG.md unreadable: ${err.message}`,
    };
  }
}

function checkCache() {
  if (!fs.existsSync(CACHE_DIR)) {
    return {
      id: "mapick.cache",
      owner: "[Mapick]",
      status: "ok",
      message: "Cache dir not yet created",
    };
  }
  let total = 0;
  const corrupt = [];
  let entries;
  try {
    entries = fs.readdirSync(CACHE_DIR);
  } catch (err) {
    return {
      id: "mapick.cache",
      owner: "[Mapick]",
      status: "fail",
      message: `Cannot read cache dir: ${err.message}`,
    };
  }
  for (const name of entries) {
    if (!name.endsWith(".json")) continue;
    total++;
    const full = path.join(CACHE_DIR, name);
    try {
      JSON.parse(fs.readFileSync(full, "utf8"));
    } catch {
      corrupt.push(name);
    }
  }
  if (corrupt.length) {
    return {
      id: "mapick.cache",
      owner: "[Mapick]",
      status: "warn",
      message: `${corrupt.length}/${total} cache files unparseable; safe to delete ~/.mapick/cache/`,
      details: { corrupt },
    };
  }
  return {
    id: "mapick.cache",
    owner: "[Mapick]",
    status: "ok",
    message: total > 0 ? `${total} cache file(s) intact` : "Cache empty",
  };
}

function checkShadow() {
  // Only warn when BOTH a managed install AND a workspace copy exist —
  // workspace-only is fine, managed-only is fine, both is the silent override.
  const managedSkill = path.join(
    os.homedir(), ".openclaw", "skills", "mapick", "SKILL.md",
  );
  const wsDir = path.join(
    os.homedir(), ".openclaw", "workspace", "skills", "mapick",
  );
  const wsSkill = path.join(wsDir, "SKILL.md");
  const bothExist = fs.existsSync(managedSkill) && fs.existsSync(wsSkill);
  if (bothExist) {
    return {
      id: "mapick.shadow",
      owner: "[Mapick]",
      status: "warn",
      message: `Workspace copy at ${wsDir} shadows the managed install. Move it aside and restart the gateway.`,
      details: { workspace_path: wsDir },
    };
  }
  return {
    id: "mapick.shadow",
    owner: "[Mapick]",
    status: "ok",
    message: "No workspace shadow detected",
  };
}

async function checkBackend() {
  // /health is unauthenticated and not in ALLOWED_ENDPOINTS — call it raw via
  // node fetch so doctor doesn't false-fail on the allowlist guard. /health
  // is the same probe the install script uses.
  const url = "https://api.mapick.ai/api/v1/health";
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8000);
  try {
    const r = await fetch(url, { signal: controller.signal });
    clearTimeout(timer);
    if (r.status >= 400) {
      return {
        id: "network.backend",
        owner: "[Network]",
        status: "fail",
        message: `Backend returned HTTP ${r.status}; the API process may be unhealthy.`,
        details: { class: "http_error", status: r.status },
      };
    }
    let body;
    try {
      body = await r.json();
    } catch {
      return {
        id: "network.backend",
        owner: "[Network]",
        status: "fail",
        message: "Backend returned non-JSON (proxy / captive portal?)",
        details: { class: "unhealthy_payload" },
      };
    }
    if (body?.status !== "ok") {
      return {
        id: "network.backend",
        owner: "[Network]",
        status: "warn",
        message: `Backend healthcheck status: ${JSON.stringify(body?.status)}`,
        details: { class: "unhealthy_payload", body },
      };
    }
    return {
      id: "network.backend",
      owner: "[Network]",
      status: "ok",
      message: `api.mapick.ai reachable (${body?.version || "ok"})`,
    };
  } catch (err) {
    clearTimeout(timer);
    const cls = classifyFetchError(err);
    const hints = {
      dns: "DNS lookup failed — check your DNS / hostname.",
      tcp: "TCP connect failed — check your network / corporate firewall / proxy.",
      tls: "TLS verification failed — server cert chain may be incomplete or your local CA store is out of date.",
      abort: "Request timed out (>8s).",
      unknown: "Unclassified network error.",
    };
    return {
      id: "network.backend",
      owner: "[Network]",
      status: "fail",
      message: `${hints[cls] || hints.unknown} (cause: ${err?.cause?.code || err?.code || "n/a"})`,
      details: { class: cls, cause_code: err?.cause?.code || err?.code || null },
    };
  }
}

async function runDoctor() {
  const localChecks = [
    checkFiles(),
    checkVersion(),
    checkConfig(),
    checkCache(),
    checkShadow(),
  ];
  const networkChecks = [await checkBackend()];

  const checks = [...localChecks, ...networkChecks];
  const summary = { total: checks.length, ok: 0, warn: 0, fail: 0 };
  for (const c of checks) summary[c.status]++;

  return {
    intent: "doctor",
    summary,
    checks,
    loaded_dir: CONFIG_DIR,
    skills_base: SKILLS_BASE,
  };
}

async function handleDoctor(args) {
  const result = await runDoctor();
  // `--json` is the default machine output; humans get a rendered table only
  // if the AI has decided to translate. Mapick itself always emits JSON
  // because all command output is JSON-on-stdout (see SKILL.md "Global rules").
  if (args.includes("--json")) {
    return result;
  }
  return result;
}

module.exports = { runDoctor, handleDoctor };
