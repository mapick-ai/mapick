// clean / clean:track / uninstall handlers + backupSkill (with 7-day TTL).

const fs = require("fs");
const path = require("path");
const {
  OUT_ARR, SKILLS_BASE, TRASH_DIR,
  isoNow, isProtected,
} = require("./core");
const { httpCall, apiCall, missingArg } = require("./http");
// path / SKILLS_BASE / TRASH_DIR / isoNow are used by the new backup:create
// and backup:restore handlers below as well as the original clean handlers.

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

async function handleClean(_args, ctx) {
  const cleanResp = await httpCall(
    "GET",
    `/users/${ctx.fp}/zombies?limit=${OUT_ARR}`,
  );
  // The previous shape `cleanResp.zombies || cleanResp || []` let backend
  // error objects ({error, statusCode}) leak through as the zombies array
  // because `error` is truthy. Pass errors through explicitly; otherwise
  // accept either a top-level array or {zombies: [...]} shape.
  if (cleanResp && cleanResp.error) return cleanResp;
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

// `backup:create <id>` — copy ~/.openclaw/skills/<id> into trash/ for restore.
// Used as Mapick-side step 1 of upgrade:plan so an upgrade can be rolled back.
function handleBackupCreate(args) {
  if (args.length < 1) return missingArg("Usage: backup:create <skillId>");
  const id = args[0];
  const skillDir = path.join(SKILLS_BASE, id);
  if (!fs.existsSync(skillDir)) {
    return { error: "not_found", skillId: id };
  }
  const backup = backupSkill(skillDir);
  return {
    intent: "backup:create",
    skillId: id,
    backup_path: backup,
    backed_up_at: isoNow(),
  };
}

// `backup:restore <id>` — pull the most recent backup of <id> back from trash/.
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
  const skillDir = path.join(SKILLS_BASE, id);
  fs.rmSync(skillDir, { recursive: true, force: true });
  fs.cpSync(latest.path, skillDir, { recursive: true });
  return {
    intent: "backup:restore",
    skillId: id,
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
