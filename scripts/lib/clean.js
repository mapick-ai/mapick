// clean / clean:track / uninstall handlers + backupSkill (with 7-day TTL).

const fs = require("fs");
const path = require("path");
const {
  OUT_ARR, SKILLS_BASE, TRASH_DIR,
  isoNow, isProtected,
} = require("./core");
const { httpCall, apiCall, missingArg } = require("./http");

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
  return {
    intent: "clean",
    zombies: cleanResp.zombies || cleanResp || [],
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
