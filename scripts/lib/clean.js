// clean / clean:track / uninstall handlers + backupSkill (with 7-day TTL).

const fs = require("fs");
const path = require("path");
const {
  OUT_ARR, SKILLS_BASE, TRASH_DIR,
  isoNow, isProtected, isConsentDeclined,
} = require("./core");
const { httpCall, apiCall, missingArg } = require("./http");
const { scanSkills } = require("./skills");

function backupSkill(skillPath) {
  if (!fs.existsSync(TRASH_DIR)) fs.mkdirSync(TRASH_DIR, { recursive: true });

  // 7-day TTL sweep so trash/ doesn't grow unbounded.
  const ttlDays = parseInt(process.env.MAPICK_TRASH_TTL_DAYS || "7", 10);
  const cutoff = Date.now() - ttlDays * 86_400_000;
  for (const name of fs.readdirSync(TRASH_DIR)) {
    const p = path.join(TRASH_DIR, name);
    try {
      if (fs.statSync(p).mtimeMs < cutoff) {
        fs.rmSync(p, { recursive: true, force: true });
      }
    } catch {}
  }

  const name = path.basename(skillPath);
  const backupPath = path.join(TRASH_DIR, `${name}_${Date.now()}`);
  fs.cpSync(skillPath, backupPath, { recursive: true });
  return backupPath;
}

// Local heuristic: a zombie is any installed skill whose SKILL.md hasn't
// been touched in MAPICK_ZOMBIE_DAYS days (default 30). Backend has richer
// signal (actual invoke counts) but the mtime heuristic is still useful for
// declined users and when the backend is offline.
function localZombies() {
  const zombieDays = parseInt(process.env.MAPICK_ZOMBIE_DAYS || "30", 10);
  const cutoff = Date.now() - zombieDays * 86_400_000;
  return scanSkills()
    .filter((s) => !isProtected(s.id))
    .filter((s) => new Date(s.last_modified).getTime() < cutoff)
    .slice(0, OUT_ARR)
    .map((s) => ({
      skillId: s.id,
      skillName: s.name,
      lastUsedAt: s.last_modified,
      installedAt: s.installed_at,
      reason: "idle_30d",
    }));
}

async function handleClean(_args, ctx) {
  // Declined users skip the backend entirely — local-only by design.
  if (isConsentDeclined(ctx.config)) {
    return {
      intent: "clean",
      local_heuristic: true,
      reason: "consent_declined",
      zombies: localZombies(),
    };
  }

  const cleanResp = await httpCall(
    "GET",
    `/users/${ctx.fp}/zombies?limit=${OUT_ARR}`,
  );
  // Network / 5xx from backend → fall back to local heuristic instead of
  // surfacing an error. Pre-existing behavior leaked the error object as
  // the zombies array (it's truthy).
  if (cleanResp && cleanResp.error) {
    return {
      intent: "clean",
      local_heuristic: true,
      reason: "backend_unreachable",
      backend_error: cleanResp.error,
      zombies: localZombies(),
    };
  }
  return {
    intent: "clean",
    zombies: Array.isArray(cleanResp) ? cleanResp : (cleanResp?.zombies || []),
  };
}

async function handleTrack(args, ctx) {
  if (args.length < 1) return missingArg("Usage: clean:track <skillId>");
  return apiCall(
    "POST",
    "/events/track",
    {
      userId: ctx.fp,
      skillId: args[0],
      action: "skill_uninstall",
      metadata: { reason: "zombie_cleanup" },
    },
    "clean:track",
  );
}

function handleUninstall(args) {
  if (args.length < 1) return missingArg("Usage: uninstall <skillId> [--confirm]");
  const targetId = args[0];
  if (!args.includes("--confirm")) {
    return { error: "confirm_required", hint: "Add --confirm to execute" };
  }
  if (isProtected(targetId)) {
    return { error: "protected_skill", skillId: targetId };
  }
  const skillDir = path.join(SKILLS_BASE, targetId);
  if (!fs.existsSync(skillDir)) {
    return { error: "not_found", skillId: targetId };
  }
  const backup = backupSkill(skillDir);
  fs.rmSync(skillDir, { recursive: true, force: true });
  return {
    intent: "uninstall",
    skillId: targetId,
    backup_path: backup,
    uninstalled_at: isoNow(),
  };
}

module.exports = {
  backupSkill,
  handleClean,
  handleTrack,
  handleUninstall,
};
