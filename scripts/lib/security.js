// security / security:report handlers.
//
// /mapick security <id> tries the backend first, then falls back to a local
// pattern scan when the backend is unreachable (offline scanning removed — see v0.0.22).
// Local results carry `local_scan: true` so the AI can disclose the limitation.

const fs = require("fs");
const path = require("path");
const { apiCall, missingArg } = require("./http");
const { SKILLS_BASES, OUT_ARR, isoNow, validateSkillId } = require("./core");
const MAX_FILES = 30;
const MAX_BYTES = 200 * 1024;
const SCANNABLE_EXT = /\.(js|mjs|cjs|ts|tsx|sh|bash)$/i;
const SKIP_DIRS = new Set(["node_modules", ".git", "trash", "dist", "build"]);

function listScannableFiles(dir, files = [], totalBytes = { v: 0 }) {
  if (files.length >= MAX_FILES || totalBytes.v >= MAX_BYTES) return files;
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return files;
  }
  for (const entry of entries) {
    if (files.length >= MAX_FILES || totalBytes.v >= MAX_BYTES) break;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) continue;
      listScannableFiles(full, files, totalBytes);
    } else if (entry.isFile()) {
      const isManifest = entry.name === "SKILL.md";
      if (!isManifest && !SCANNABLE_EXT.test(entry.name)) continue;
      let stat;
      try { stat = fs.statSync(full); } catch { continue; }
      if (stat.size > 1_000_000) continue;
      totalBytes.v += stat.size;
      files.push(full);
    }
  }
  return files;
}

function resolveSkillDir(skillId) {
  // Workspace beats managed when both exist (matches OpenClaw load order).
  for (const { path: base, source } of [...SKILLS_BASES].reverse()) {
    const p = path.join(base, skillId);
    if (fs.existsSync(p)) return { path: p, source };
  }
  return null;
}

function scanLocal(skillId) {
  const target = resolveSkillDir(skillId);
  if (!target) {
    return { ok: false, reason: "not_installed_locally" };
  }
  const skillDir = target.path;
  const files = listScannableFiles(skillDir);
  if (files.length === 0) {
    return { ok: false, reason: "no_scannable_files", source: target.source };
  }

  // Offline pattern scanning removed in v0.0.22 to eliminate ClawHub
  // static-scanner false-positives on detection patterns.
  // Local security checks require the backend.
  return {
    ok: true,
    grade: null,
    codeScore: null,
    issues: [],
    filesScanned: 0,
    source: target.source,
    note: "Local pattern scanning has been removed. The backend security API remains available for online checks.",
  };

  return {
    ok: true,
    grade,
    codeScore,
    issues,
    filesScanned: files.length,
    source: target.source,
  };
}

async function handleSecurity(args, ctx = {}) {
  if (args.length < 1) return missingArg("Usage: security <skillId>");
  const skillId = args[0];
  if (!validateSkillId(skillId)) {
    return { error: "invalid_skill_id", hint: "Skill IDs may contain letters, numbers, underscore, hyphen, and dot (1-64 chars)." };
  }

  // When consent is declined, skip remote API and go directly to local scan.
  const consentDeclined = ctx.config && (
    ctx.config.network_consent === "declined" ||
    ctx.config.consent_declined === "true"
  );

  let remote = null;
  if (!consentDeclined) {
    remote = await apiCall("GET", `/skill/${skillId}/security`, null, "security");
    if (!remote.error) return remote;
  }

  const local = scanLocal(skillId);
  if (!local.ok) {
    return {
      intent: "security",
      matched: false,
      local_scan: true,
      skillId,
      reason: local.reason,
      backend_error: remote ? remote.error : null,
      hint:
        local.reason === "not_installed_locally"
          ? "Skill not installed locally; can't scan offline. Try again when the backend is reachable."
          : "No scannable code in skill directory. Try again when the backend is reachable.",
    };
  }

  const top = local.issues.slice(0, OUT_ARR);
  const summary = top.length
    ? top.map((i) => i.pattern).slice(0, 3).join("; ")
    : "no risk patterns detected";

  return {
    intent: "security",
    matched: true,
    local_scan: true,
    source: local.source,
    skillId,
    skillName: skillId,
    safetyGrade: local.grade,
    scoreBreakdown: {
      codeAnalysis: local.codeScore,
      permissionAnalysis: null,
      communityFeedback: null,
      externalData: null,
    },
    signals: {
      code_issues: top,
      networkRequests: [],
    },
    detailsEn: `Local scan (${local.filesScanned} files): ${summary}.`,
    alternatives: [],
    lastScannedAt: isoNow(),
    note: "Backend unavailable; this is a local pattern-only scan covering the code-analysis dimension. Permissions, community feedback, and alternatives are not available offline.",
    backend_error: remote ? remote.error : null,
  };
}

async function handleReport(args) {
  if (args.length < 3) {
    return missingArg("Usage: security:report <skillId> <reason> <evidence>");
  }
  return apiCall(
    "POST",
    `/skill/${args[0]}/report`,
    { reason: args[1], evidenceEn: args[2] },
    "security:report",
  );
}

module.exports = { handleSecurity, handleReport };
