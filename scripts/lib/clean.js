// clean / clean:track / uninstall handlers + backupSkill (with 7-day TTL).

const fs = require("fs");
const path = require("path");
const {
  OUT_ARR, SKILLS_BASE, WORKSPACE_SKILLS_BASE, TRASH_DIR,
  isoNow, isProtected, isConsentDeclined,
} = require("./core");
const { httpCall, apiCall, missingArg } = require("./http");
const { scanSkills, scanAllSkills } = require("./skills");

// Resolve `<skillId>` (+ optional `--source=managed|workspace`) to a single
// install path. Returns `{ ok: true, path, source }` or `{ ok: false, error,
// ... }` if the id is missing or ambiguous between bases.
function resolveSkillTarget(targetId, args) {
  const sourceArg = (args.find((a) => a.startsWith("--source=")) || "").split("=")[1];
  const candidates = scanAllSkills().filter((s) => s.id === targetId);
  if (candidates.length === 0) {
    return { ok: false, error: "not_found", skillId: targetId };
  }
  if (sourceArg) {
    const picked = candidates.find((c) => c.source === sourceArg);
    if (!picked) {
      return {
        ok: false,
        error: "not_found",
        skillId: targetId,
        source: sourceArg,
        hint: `No ${sourceArg} install of ${targetId}.`,
      };
    }
    return { ok: true, path: picked.path, source: picked.source };
  }
  if (candidates.length > 1) {
    return {
      ok: false,
      error: "ambiguous_source",
      skillId: targetId,
      sources: candidates.map((c) => c.source),
      hint: "Add --source=managed or --source=workspace to disambiguate.",
    };
  }
  return { ok: true, path: candidates[0].path, source: candidates[0].source };
}

function backupSkill(skillPath) {
  const linkStat = fs.lstatSync(skillPath);
  if (linkStat.isSymbolicLink()) {
    const err = new Error("symlink_skill");
    err.code = "symlink_skill";
    throw err;
  }
  const stat = fs.statSync(skillPath);
  if (!stat.isDirectory()) {
    const err = new Error("not_a_directory");
    err.code = "not_a_directory";
    throw err;
  }
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
  const includeWorkspace = process.env.MAPICK_ZOMBIE_INCLUDE_WORKSPACE === "1";
  const cutoff = Date.now() - zombieDays * 86_400_000;
  return scanSkills()
    .filter((s) => !isProtected(s.id))
    // Workspace is where users iterate WIP skills — calling them "zombies"
    // and prompting cleanup would surprise the user. Exclude unless the
    // operator explicitly asks (`MAPICK_ZOMBIE_INCLUDE_WORKSPACE=1`).
    .filter((s) => includeWorkspace || s.source !== "workspace")
    .filter((s) => new Date(s.last_modified).getTime() < cutoff)
    .slice(0, OUT_ARR)
    .map((s) => ({
      skillId: s.id,
      skillName: s.name,
      lastUsedAt: s.last_modified,
      installedAt: s.installed_at,
      reason: "idle_30d",
      source: s.source,
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
  if (args.length < 1) {
    return missingArg("Usage: uninstall <skillId> [--confirm] [--source=managed|workspace]");
  }
  const targetId = args[0];
  if (!args.includes("--confirm")) {
    return { error: "confirm_required", hint: "Add --confirm to execute" };
  }
  if (isProtected(targetId)) {
    return { error: "protected_skill", skillId: targetId };
  }
  const resolved = resolveSkillTarget(targetId, args);
  if (!resolved.ok) return resolved;
  const skillDir = resolved.path;
  let backup;
  try {
    backup = backupSkill(skillDir);
  } catch (err) {
    return {
      error: err.code || "backup_failed",
      skillId: targetId,
      source: resolved.source,
      hint:
        err.code === "symlink_skill"
          ? "Refusing to uninstall a symlinked skill. Remove the link manually if intentional."
          : err.message,
    };
  }
  fs.rmSync(skillDir, { recursive: true, force: true });
  return {
    intent: "uninstall",
    skillId: targetId,
    source: resolved.source,
    backup_path: backup,
    uninstalled_at: isoNow(),
  };
}

// `backup:create <id>` — copy the install dir into trash/ for restore.
// Used as Mapick-side step 1 of upgrade:plan so an upgrade can be rolled back.
function handleBackupCreate(args) {
  if (args.length < 1) {
    return missingArg("Usage: backup:create <skillId> [--source=managed|workspace]");
  }
  const id = args[0];
  const resolved = resolveSkillTarget(id, args);
  if (!resolved.ok) return resolved;
  let backup;
  try {
    backup = backupSkill(resolved.path);
  } catch (err) {
    return {
      error: err.code || "backup_failed",
      skillId: id,
      source: resolved.source,
      hint:
        err.code === "symlink_skill"
          ? "Refusing to back up a symlinked skill. Back up the real directory manually if intentional."
          : err.message,
    };
  }
  return {
    intent: "backup:create",
    skillId: id,
    source: resolved.source,
    backup_path: backup,
    backed_up_at: isoNow(),
  };
}

// `backup:restore <id>` — pull the most recent backup of <id> back into the
// matching base. If the skill currently exists in workspace, restore there;
// otherwise restore to managed.
function handleBackupRestore(args) {
  if (args.length < 1) return missingArg("Usage: backup:restore <skillId>");
  const id = args[0];
  if (!fs.existsSync(TRASH_DIR)) {
    return { error: "no_backup_found", skillId: id };
  }
  const matches = fs
    .readdirSync(TRASH_DIR)
    .filter((name) => name.startsWith(`${id}_`))
    .map((name) => ({
      name,
      path: path.join(TRASH_DIR, name),
      mtime: fs.statSync(path.join(TRASH_DIR, name)).mtimeMs,
    }))
    .sort((a, b) => b.mtime - a.mtime);
  if (matches.length === 0) {
    return { error: "no_backup_found", skillId: id };
  }
  const latest = matches[0];
  // Pick base by current presence; default to managed if absent from both.
  const wsPath = path.join(WORKSPACE_SKILLS_BASE, id);
  const managedPath = path.join(SKILLS_BASE, id);
  let skillDir = managedPath;
  let source = "managed";
  if (fs.existsSync(wsPath)) {
    skillDir = wsPath;
    source = "workspace";
  } else if (!fs.existsSync(managedPath)) {
    // Neither present; default to managed (where new installs land).
    skillDir = managedPath;
    source = "managed";
  }
  fs.rmSync(skillDir, { recursive: true, force: true });
  fs.cpSync(latest.path, skillDir, { recursive: true });
  return {
    intent: "backup:restore",
    skillId: id,
    source,
    restored_from: latest.path,
    restored_at: isoNow(),
  };
}

module.exports = {
  backupSkill,
  handleClean,
  handleTrack,
  handleUninstall,
  handleBackupCreate,
  handleBackupRestore,
};
