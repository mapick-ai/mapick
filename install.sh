#!/usr/bin/env bash
# Mapick Skill — Install Script (atomic install pipeline)
#
# Recommended install path is `clawhub install mapick`. This script is for
# recovery, CI, pinned versions, or environments without ClawHub access.
# Always review the script before running it:
#
#   curl -fsSL https://raw.githubusercontent.com/mapick-ai/mapick/v0.0.24/install.sh -o install.sh
#   less install.sh
#   bash install.sh
#
# Options (via environment variables):
#   MAPICK_VERSION=v0.0.24                  Install specific version
#   MAPICK_REPO=owner/repo                  Override source repo
#   MAPICK_DISABLE_WORKSPACE_DUPLICATE=1    Move shadowing workspace copy aside
#   MAPICK_INSTALL_ASSUME_YES=1             Auto-accept overwrite/upgrade
#   MAPICK_INSTALL_DRY_RUN=1                Preflight only, no download or write
#   MAPICK_INSTALL_JSON=1                   Emit machine-readable JSON progress
#   MAPICK_INSTALL_FORCE_DOWNGRADE=1        Allow installing over a newer version
#   MAPICK_INSTALL_FORCE_OVERWRITE=1        Allow installing over unknown source
#   MAPICK_INSTALL_BACKUP_KEEP=3            How many backups to retain (default 3)

set -e

# -- Platform check ------------------------------------------------------------
# `install.sh` is bash-only. On Windows, OpenClaw users should run install via
# WSL (Linux subsystem) — Git Bash / Cygwin / MSYS / MINGW environments don't
# have the symlink + chmod + permissions semantics OpenClaw assumes, and
# silently miscopying files there has historically wedged the install. Bail
# before any destructive write.
case "$(uname -s 2>/dev/null)" in
  Linux*|Darwin*)
    : # POSIX path, OK to proceed
    ;;
  CYGWIN*|MSYS*|MINGW*|MSYS_NT*|MINGW64_NT*|MINGW32_NT*)
    echo "ERROR: install.sh detected a non-POSIX shell ($(uname -s))." >&2
    echo "" >&2
    echo "On Windows, install Mapick via WSL (Windows Subsystem for Linux):" >&2
    echo "  1. Open PowerShell as administrator and run:  wsl --install" >&2
    echo "  2. Reboot, open the Ubuntu app, then re-run install.sh inside WSL." >&2
    echo "" >&2
    echo "WSL setup: https://learn.microsoft.com/windows/wsl/install" >&2
    exit 1
    ;;
  *)
    # Unknown OS — let it proceed but warn. We've never tested here, so the
    # user gets ownership of the outcome.
    echo "WARN: unrecognized OS '$(uname -s 2>/dev/null)'. install.sh has only been tested on macOS / Linux / WSL — proceed at your own risk." >&2
    ;;
esac

# -- Config --------------------------------------------------------------------

REPO="${MAPICK_REPO:-mapick-ai/mapick}"
VERSION="${MAPICK_VERSION:-latest}"

ASSUME_YES="${MAPICK_INSTALL_ASSUME_YES:-0}"
DRY_RUN="${MAPICK_INSTALL_DRY_RUN:-0}"
JSON_MODE="${MAPICK_INSTALL_JSON:-0}"
FORCE_DOWNGRADE="${MAPICK_INSTALL_FORCE_DOWNGRADE:-0}"
FORCE_OVERWRITE="${MAPICK_INSTALL_FORCE_OVERWRITE:-0}"
BACKUP_KEEP="${MAPICK_INSTALL_BACKUP_KEEP:-3}"

GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
BOLD='\033[1m'
DIM='\033[2m'
NC='\033[0m'

# -- Output helpers ------------------------------------------------------------
# JSON mode: machine-readable single-line events on stdout, no colors.
# Human mode: existing colored output.

json_event() {
  if [[ "${JSON_MODE}" != "1" ]]; then return 0; fi
  local type="$1"; shift
  local out="{\"event\":\"${type}\""
  while [[ $# -gt 0 ]]; do
    local kv="$1"; shift
    local k="${kv%%=*}"
    local v="${kv#*=}"
    # Escape JSON special chars: backslash, quote, newline, tab, CR.
    v="${v//\\/\\\\}"
    v="${v//\"/\\\"}"
    v="${v//$'\n'/\\n}"
    v="${v//$'\r'/\\r}"
    v="${v//$'\t'/\\t}"
    out+=",\"${k}\":\"${v}\""
  done
  out+="}"
  echo "${out}"
}

info()  {
  if [[ "${JSON_MODE}" == "1" ]]; then json_event info msg="$*"; else echo -e "${BLUE}[INFO]${NC}  $*"; fi
}
ok()    {
  if [[ "${JSON_MODE}" == "1" ]]; then json_event ok msg="$*"; else echo -e "${GREEN}[OK]${NC}    $*"; fi
}
warn()  {
  if [[ "${JSON_MODE}" == "1" ]]; then json_event warn msg="$*"; else echo -e "${YELLOW}[WARN]${NC}  $*"; fi
}
error() {
  if [[ "${JSON_MODE}" == "1" ]]; then
    json_event error msg="$*"
  else
    echo -e "${RED}[ERROR]${NC} $*" >&2
  fi
  exit 1
}
dim_echo() {
  if [[ "${JSON_MODE}" != "1" ]]; then echo -e "${DIM}$*${NC}"; fi
}

# -- Banner --------------------------------------------------------------------

if [[ "${JSON_MODE}" != "1" ]]; then
  echo ""
  echo -e "${CYAN}"
  echo '  ╔══════════════════════════════════════════╗'
  echo '  ║                                          ║'
  echo '  ║              M A P I C K                 ║'
  echo '  ║       Mapick Intelligent Butler          ║'
  echo '  ║                                          ║'
  echo '  ╚══════════════════════════════════════════╝'
  echo -e "${NC}"
fi

json_event start version="${VERSION}" repo="${REPO}" dry_run="${DRY_RUN}"

# -- Resolve version -----------------------------------------------------------

if [[ "${VERSION}" == "latest" ]]; then
  info "Fetching latest version..."
  RESOLVED_VERSION=$(curl -fsSL "https://api.github.com/repos/${REPO}/releases/latest" 2>/dev/null \
    | grep '"tag_name"' | head -1 | sed 's/.*"tag_name": *"\([^"]*\)".*/\1/') || true

  if [[ -z "${RESOLVED_VERSION}" ]]; then
    warn "Cannot fetch latest release, falling back to main branch"
    VERSION="main"
  else
    VERSION="${RESOLVED_VERSION}"
  fi
fi

info "Version: ${VERSION}"

# -- Detect OpenClaw -----------------------------------------------------------

OPENCLAW_PATH=""
if command -v claw &>/dev/null; then
  OPENCLAW_PATH="$(command -v claw)"
elif command -v openclaw &>/dev/null; then
  OPENCLAW_PATH="$(command -v openclaw)"
fi

if [[ -z "${OPENCLAW_PATH}" ]]; then
  error "OpenClaw not detected.

  Mapick V1 only supports OpenClaw. Install OpenClaw first:
    https://openclaw.io

  Then retry this script."
fi

ok "OpenClaw detected: ${OPENCLAW_PATH}"

# -- Detect runtime (Node.js >=22.14 required) ---------------------------------

if ! command -v node &>/dev/null; then
  error "Node.js not detected. Mapick requires Node.js 22.14 or later
  (the OpenClaw runtime baseline; OpenClaw recommends 24).

  Install Node.js: https://nodejs.org
  Then retry this script."
fi

NODE_VER="$(node --version)"
NODE_MAJOR="$(echo "${NODE_VER}" | sed 's/^v\([0-9]*\).*/\1/')"
NODE_MINOR="$(echo "${NODE_VER}" | sed 's/^v[0-9]*\.\([0-9]*\).*/\1/')"
if ! [[ "${NODE_MAJOR}" =~ ^[0-9]+$ ]] \
   || (( NODE_MAJOR < 22 )) \
   || { (( NODE_MAJOR == 22 )) && (( NODE_MINOR < 14 )); }; then
  error "Node.js ${NODE_VER} is too old. Mapick requires Node.js 22.14 or later
  (the OpenClaw runtime baseline; OpenClaw recommends 24).

  Upgrade Node.js: https://nodejs.org
  Then retry this script."
fi

ok "Node.js detected: ${NODE_VER}"

# -- Detect shadowing workspace Skill ------------------------------------------

workspace_skill_dir="${HOME}/.openclaw/workspace/skills/mapick"
if [[ -f "${workspace_skill_dir}/SKILL.md" ]] \
   && grep -Eq '^name:[[:space:]]*mapick[[:space:]]*$' "${workspace_skill_dir}/SKILL.md"; then
  echo ""
  warn "Workspace Skill shadows managed Mapick:"
  echo -e "    ${YELLOW}${workspace_skill_dir}${NC}"
  echo ""
  echo "OpenClaw loads workspace skills before managed skills, so this copy can"
  echo "override the version installed to ~/.openclaw/skills/mapick."
  echo ""

  if [[ "${MAPICK_DISABLE_WORKSPACE_DUPLICATE:-0}" == "1" ]]; then
    disabled_dir="${HOME}/.openclaw/workspace/mapick.disabled-$(date +%Y%m%d-%H%M%S)"
    mv "${workspace_skill_dir}" "${disabled_dir}"
    ok "Moved shadowing workspace copy to:"
    dim_echo "    ${disabled_dir}"
  else
    echo "To use the newly installed version, move the workspace copy aside and"
    echo "restart the gateway:"
    echo ""
    echo "    mv ~/.openclaw/workspace/skills/mapick ~/.openclaw/workspace/mapick.disabled-\$(date +%Y%m%d-%H%M%S)"
    echo "    openclaw gateway restart"
    echo ""
    echo "Or rerun this installer with:"
    echo ""
    echo "    MAPICK_DISABLE_WORKSPACE_DUPLICATE=1 bash install.sh"
  fi
fi

# -- Resolve install paths -----------------------------------------------------

target_dir="${HOME}/.openclaw/skills/mapick"
parent_dir="$(dirname "${target_dir}")"
target_name="$(basename "${target_dir}")"
staging_dir="${parent_dir}/.${target_name}.tmp-$$"
backup_dir="${parent_dir}/.${target_name}.backup-$(date +%Y%m%d-%H%M%S)"

# -- Preflight conflict classification -----------------------------------------
# Possible states:
#   - not_installed       — target_dir absent; install fresh
#   - same_version        — .version equals VERSION; skip with exit 0
#   - older_version       — .version semver < VERSION; backup + upgrade
#   - newer_version       — .version semver > VERSION; refuse unless force
#   - unknown_source      — dir exists, no .version; refuse unless force

semver_to_int() {
  # vX.Y.Z[-suffix] → X*1e6 + Y*1e3 + Z (suffix ignored)
  local v="${1#v}"
  v="${v%%-*}"
  IFS='.' read -r maj min pat <<<"${v}"
  maj="${maj:-0}"; min="${min:-0}"; pat="${pat:-0}"
  if ! [[ "${maj}" =~ ^[0-9]+$ ]] || ! [[ "${min}" =~ ^[0-9]+$ ]] || ! [[ "${pat}" =~ ^[0-9]+$ ]]; then
    echo "0"; return
  fi
  echo $(( maj * 1000000 + min * 1000 + pat ))
}

CONFLICT_STATE="not_installed"
CURRENT_VERSION=""
if [[ -d "${target_dir}" ]]; then
  if [[ -f "${target_dir}/.version" ]]; then
    CURRENT_VERSION="$(head -1 "${target_dir}/.version" | tr -d '[:space:]')"
    if [[ "${CURRENT_VERSION}" == "${VERSION}" ]]; then
      CONFLICT_STATE="same_version"
    else
      cur_int="$(semver_to_int "${CURRENT_VERSION}")"
      new_int="$(semver_to_int "${VERSION}")"
      if (( cur_int < new_int )); then
        CONFLICT_STATE="older_version"
      elif (( cur_int > new_int )); then
        CONFLICT_STATE="newer_version"
      else
        # equal as int but string-different (e.g. main vs v0.0.15) — treat as upgrade
        CONFLICT_STATE="older_version"
      fi
    fi
  else
    CONFLICT_STATE="unknown_source"
  fi
fi

json_event preflight state="${CONFLICT_STATE}" current_version="${CURRENT_VERSION}" target_version="${VERSION}"

case "${CONFLICT_STATE}" in
  not_installed)
    info "Fresh install (target dir does not exist)."
    ;;
  same_version)
    ok "Already at ${VERSION} — nothing to do."
    json_event done state="same_version"
    if [[ "${JSON_MODE}" != "1" ]]; then
      echo ""
      echo -e "  ${BLUE}Tip:${NC} If \`/mapick\` doesn't show in your current OpenClaw"
      echo "  conversation, start a new session — skill snapshots are loaded once"
      echo "  per session."
    fi
    exit 0
    ;;
  older_version)
    info "Upgrade ${CURRENT_VERSION} → ${VERSION}"
    ;;
  newer_version)
    if [[ "${FORCE_DOWNGRADE}" != "1" ]]; then
      error "Refusing to downgrade ${CURRENT_VERSION} → ${VERSION}.

  The installed version is newer than the requested target. To override, set
  MAPICK_INSTALL_FORCE_DOWNGRADE=1 and re-run this script."
    fi
    warn "Forcing downgrade ${CURRENT_VERSION} → ${VERSION} (MAPICK_INSTALL_FORCE_DOWNGRADE=1)"
    ;;
  unknown_source)
    if [[ "${FORCE_OVERWRITE}" != "1" && "${ASSUME_YES}" != "1" ]]; then
      error "An unrecognized Mapick install exists at ${target_dir} (no .version file).

  This may be from a manual extraction or a fork. To overwrite it, set
  MAPICK_INSTALL_FORCE_OVERWRITE=1 (or MAPICK_INSTALL_ASSUME_YES=1) and
  re-run this script. The current contents will be moved to a timestamped
  backup before the install."
    fi
    warn "Overwriting unrecognized install at ${target_dir}"
    ;;
esac

# -- Dry-run exit --------------------------------------------------------------

if [[ "${DRY_RUN}" == "1" ]]; then
  ok "Dry run complete — no files written."
  json_event done state="dry_run" planned_state="${CONFLICT_STATE}"
  exit 0
fi

# -- Download tarball ----------------------------------------------------------

REF="${VERSION}"
TARBALL_URL="https://github.com/${REPO}/archive/${REF}.tar.gz"

echo ""
dim_echo "────────────────────────────────────────"
echo ""
info "Downloading Mapick Skill (${VERSION})..."
json_event download url="${TARBALL_URL}"

TMP_DIR=$(mktemp -d)

# Cleanup hook: remove TMP_DIR + staging_dir if still present (failure cases).
cleanup() {
  rm -rf "${TMP_DIR}"
  [[ -d "${staging_dir}" ]] && rm -rf "${staging_dir}"
}
trap cleanup EXIT

TARBALL="${TMP_DIR}/mapick.tar.gz"
if ! curl -fsSL --retry 3 --retry-delay 2 --retry-connrefused \
     "${TARBALL_URL}" -o "${TARBALL}"; then
  error "Failed to download ${TARBALL_URL} (after 3 retries)"
fi

if ! tar -xzf "${TARBALL}" -C "${TMP_DIR}" --strip-components=1; then
  error "Failed to extract tarball (file may be corrupt: ${TARBALL})"
fi

rm -f "${TARBALL}"

ok "Download complete"

# -- Stage to .mapick.tmp-<pid>/ -----------------------------------------------

info "Staging install to ${staging_dir}"
json_event stage path="${staging_dir}"

mkdir -p "${staging_dir}"

INSTALL_ITEMS=(SKILL.md LICENSE scripts reference prompts)
for item in "${INSTALL_ITEMS[@]}"; do
  if [[ -e "${TMP_DIR}/${item}" ]]; then
    cp -R "${TMP_DIR}/${item}" "${staging_dir}/"
  fi
done

# Ensure entry scripts are executable
for exe in scripts/shell.js scripts/redact.js; do
  [[ -f "${staging_dir}/${exe}" ]] && chmod +x "${staging_dir}/${exe}"
done

# Record installed version
echo "${VERSION}" > "${staging_dir}/.version"

# Verify staged install before touching the live target_dir
if [[ ! -f "${staging_dir}/SKILL.md" ]] || [[ ! -f "${staging_dir}/scripts/shell.js" ]]; then
  error "Staging failed — required files missing in ${staging_dir}."
fi

ok "Staged"

# -- Backup existing target ----------------------------------------------------

did_backup=0
if [[ -d "${target_dir}" ]]; then
  info "Backing up existing install to ${backup_dir}"
  json_event backup from="${target_dir}" to="${backup_dir}"
  cp -R "${target_dir}" "${backup_dir}"
  did_backup=1
fi

# Preserve user state across upgrades. These survive even if user-content
# files were removed in newer versions.
preserve_user_state() {
  local from="$1"
  local to="$2"
  for keep in CONFIG.md cache trash; do
    if [[ -e "${from}/${keep}" ]]; then
      cp -R "${from}/${keep}" "${to}/"
      dim_echo "    Preserved: ${keep}"
    fi
  done
}

if [[ "${did_backup}" == "1" ]]; then
  preserve_user_state "${backup_dir}" "${staging_dir}"
fi

# -- Atomic swap ---------------------------------------------------------------

rollback() {
  warn "Install failed — rolling back."
  json_event rollback from="${backup_dir}" to="${target_dir}"
  rm -rf "${target_dir}"
  if [[ "${did_backup}" == "1" ]] && [[ -d "${backup_dir}" ]]; then
    mv "${backup_dir}" "${target_dir}"
  fi
}

info "Atomic swap → ${target_dir}"
json_event swap target="${target_dir}"

# Remove the old target dir; backup is already taken.
if [[ -d "${target_dir}" ]]; then
  rm -rf "${target_dir}"
fi

# mv staging to target. If this fails, rollback.
if ! mv "${staging_dir}" "${target_dir}"; then
  rollback
  error "Atomic rename failed — original restored from backup."
fi

# Final verify after swap
if [[ ! -f "${target_dir}/SKILL.md" ]] || [[ ! -f "${target_dir}/scripts/shell.js" ]]; then
  rollback
  error "Post-swap verification failed — required files missing. Rolled back."
fi

ok "Installed at ${target_dir}"

# -- Post-install verification -------------------------------------------------
# Three-step verification to ensure the install is functional before claiming success.

echo ""
dim_echo "────────────────────────────────────────"
echo ""
info "Running post-install verification..."

# Step 1: File integrity check (SKILL.md + shell.js exist)
json_event verify step="1" kind="file_integrity" status="running"
if [[ ! -f "${target_dir}/SKILL.md" ]]; then
  json_event verify step="1" kind="file_integrity" status="failed" missing="SKILL.md"
  rollback
  error "Verification failed — SKILL.md missing in ${target_dir}. Rolled back."
fi
if [[ ! -f "${target_dir}/scripts/shell.js" ]]; then
  json_event verify step="1" kind="file_integrity" status="failed" missing="scripts/shell.js"
  rollback
  error "Verification failed — scripts/shell.js missing in ${target_dir}. Rolled back."
fi
json_event verify step="1" kind="file_integrity" status="passed"
ok "Step 1/3: File integrity check passed"

# Step 2: init scan (call node scripts/shell.js init)
json_event verify step="2" kind="init_scan" status="running"
if ! node "${target_dir}/scripts/shell.js" init 2>/dev/null; then
  json_event verify step="2" kind="init_scan" status="failed"
  warn "Step 2/3: init scan had issues (non-critical, continuing)"
else
  json_event verify step="2" kind="init_scan" status="passed"
  ok "Step 2/3: init scan completed"
fi

# Step 3: Environment check (Node.js version)
json_event verify step="3" kind="env_check" status="running"
NODE_CHECK_VER="$(node --version)"
NODE_CHECK_MAJOR="$(echo "${NODE_CHECK_VER}" | sed 's/^v\([0-9]*\).*/\1/')"
NODE_CHECK_MINOR="$(echo "${NODE_CHECK_VER}" | sed 's/^v[0-9]*\.\([0-9]*\).*/\1/')"
if ! [[ "${NODE_CHECK_MAJOR}" =~ ^[0-9]+$ ]] \
   || (( NODE_CHECK_MAJOR < 22 )) \
   || { (( NODE_CHECK_MAJOR == 22 )) && (( NODE_CHECK_MINOR < 14 )); }; then
  json_event verify step="3" kind="env_check" status="failed" node_version="${NODE_CHECK_VER}"
  warn "Step 3/3: Node.js ${NODE_CHECK_VER} is below recommended 22.14 (may affect functionality)"
else
  json_event verify step="3" kind="env_check" status="passed" node_version="${NODE_CHECK_VER}"
  ok "Step 3/3: Node.js ${NODE_CHECK_VER} meets baseline"
fi

json_event verify status="complete" target="${target_dir}"

# -- Trim backups (keep most recent N) -----------------------------------------

if [[ "${BACKUP_KEEP}" =~ ^[0-9]+$ ]] && (( BACKUP_KEEP > 0 )); then
  shopt -s nullglob
  backups=("${parent_dir}/.${target_name}".backup-*)
  shopt -u nullglob
  if (( ${#backups[@]} > BACKUP_KEEP )); then
    IFS=$'\n' sorted=($(printf '%s\n' "${backups[@]}" | sort -r))
    unset IFS
    for ((i = BACKUP_KEEP; i < ${#sorted[@]}; i++)); do
      rm -rf "${sorted[$i]}"
      dim_echo "    Trimmed old backup: $(basename "${sorted[$i]}")"
    done
  fi
fi

# -- Summary -------------------------------------------------------------------
# Re-check shadow at the END of install. If both a managed install AND a
# workspace copy now exist, OpenClaw will still load the workspace one and
# the upgrade is silently shadowed. Only show the reminder when both exist —
# a single install (managed-only OR workspace-only) is fine.
shadow_remaining=0
if [[ -f "${target_dir}/SKILL.md" ]] \
   && [[ -f "${workspace_skill_dir}/SKILL.md" ]] \
   && grep -Eq '^name:[[:space:]]*mapick[[:space:]]*$' "${workspace_skill_dir}/SKILL.md"; then
  shadow_remaining=1
fi

json_event done state="${CONFLICT_STATE}" version="${VERSION}" target="${target_dir}" shadow_remaining="${shadow_remaining}"

if [[ "${JSON_MODE}" == "1" ]]; then
  exit 0
fi

echo ""
dim_echo "────────────────────────────────────────"
echo ""

ok "Done!"
echo ""
echo -e "  ${GREEN}Version${NC}: ${VERSION}"
if [[ "${did_backup}" == "1" ]]; then
  echo -e "  ${GREEN}Backup${NC}:  ${backup_dir}"
fi
echo ""

if [[ "${shadow_remaining}" == "1" ]]; then
  echo -e "  ${YELLOW}⚠️  Shadow still active${NC}"
  echo ""
  echo "  You have a workspace copy at:"
  echo -e "    ${YELLOW}${workspace_skill_dir}${NC}"
  echo ""
  echo "  OpenClaw loads workspace before managed, so the upgrade you just"
  echo "  installed is shadowed. To activate it:"
  echo ""
  echo "    rm -rf ~/.openclaw/workspace/skills/mapick"
  echo "    openclaw gateway restart"
  echo ""
fi

echo -e "  ${BLUE}Get started:${NC}"
echo "    /mapick                View status overview"
echo "    /mapick status         Detailed status"
echo "    /mapick clean          Clean up zombies"
echo "    /mapick bundle         Browse bundles"
echo "    /mapick daily          Daily report"
echo ""
echo -e "  ${CYAN}More info: https://github.com/${REPO}${NC}"
echo ""
