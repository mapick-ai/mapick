#!/usr/bin/env bash
# Mapick Skill — Install Script (V1: OpenClaw only)
#
# Recommended install path is `clawhub install mapick`. This script is for
# recovery, CI, pinned versions, or environments without ClawHub access.
# Always review the script before running it:
#
#   curl -fsSL https://raw.githubusercontent.com/mapick-ai/mapick/v0.0.7/install.sh -o install.sh
#   less install.sh
#   bash install.sh
#
# Options (via environment variables):
#   MAPICK_VERSION=v0.0.7  ./install.sh   # Install specific version
#   MAPICK_REPO=owner/repo ./install.sh   # Override source repo

set -e

# -- Config --------------------------------------------------------------------

REPO="${MAPICK_REPO:-mapick-ai/mapick}"
VERSION="${MAPICK_VERSION:-latest}"

GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
BOLD='\033[1m'
DIM='\033[2m'
NC='\033[0m'

info()  { echo -e "${BLUE}[INFO]${NC}  $*"; }
ok()    { echo -e "${GREEN}[OK]${NC}    $*"; }
warn()  { echo -e "${YELLOW}[WARN]${NC}  $*"; }
error() { echo -e "${RED}[ERROR]${NC} $*" >&2; exit 1; }

# -- Banner --------------------------------------------------------------------

echo ""
echo -e "${CYAN}"
echo '  ╔══════════════════════════════════════════╗'
echo '  ║                                          ║'
echo '  ║              M A P I C K                 ║'
echo '  ║       Mapick Intelligent Butler          ║'
echo '  ║                                          ║'
echo '  ╚══════════════════════════════════════════╝'
echo -e "${NC}"

# -- Resolve version -----------------------------------------------------------

if [[ "${VERSION}" == "latest" ]]; then
  info "Fetching latest version..."
  VERSION=$(curl -fsSL "https://api.github.com/repos/${REPO}/releases/latest" 2>/dev/null \
    | grep '"tag_name"' | head -1 | sed 's/.*"tag_name": *"\([^"]*\)".*/\1/') || true

  if [[ -z "${VERSION}" ]]; then
    warn "Cannot fetch latest release, falling back to main branch"
    VERSION="main"
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

# -- Download tarball ----------------------------------------------------------

REF="${VERSION}"
TARBALL_URL="https://github.com/${REPO}/archive/${REF}.tar.gz"

echo ""
echo -e "${DIM}────────────────────────────────────────${NC}"
echo ""
info "Downloading Mapick Skill (${VERSION})..."

TMP_DIR=$(mktemp -d)
trap "rm -rf ${TMP_DIR}" EXIT

# Download to file first (curl --retry needs a clean restart point; piping into
# tar makes retries useless because tar has already consumed partial data).
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

# -- Install to OpenClaw -------------------------------------------------------

target_dir="${HOME}/.openclaw/skills/mapick"

echo ""
info "Installing to ${BOLD}OpenClaw${NC} ..."

# Preserve user-editable CONFIG.md across upgrades
BACKUP_CONFIG=""
if [[ -f "${target_dir}/CONFIG.md" ]]; then
  BACKUP_CONFIG="$(mktemp)"
  cp "${target_dir}/CONFIG.md" "${BACKUP_CONFIG}"
fi

if [[ -d "${target_dir}" ]]; then
  warn "Existing installation found, overwriting..."
  rm -rf "${target_dir}"
fi

mkdir -p "${target_dir}"

# Copy runtime files (Skill payload, not repo boilerplate).
# Keep this list in sync with what SKILL.md references.
INSTALL_ITEMS=(SKILL.md LICENSE scripts reference prompts)
for item in "${INSTALL_ITEMS[@]}"; do
  if [[ -e "${TMP_DIR}/${item}" ]]; then
    cp -R "${TMP_DIR}/${item}" "${target_dir}/"
  fi
done

# Ensure entry scripts are executable
for exe in scripts/shell.js scripts/redact.js; do
  [[ -f "${target_dir}/${exe}" ]] && chmod +x "${target_dir}/${exe}"
done

# Restore user config if present
if [[ -n "${BACKUP_CONFIG}" ]]; then
  cp "${BACKUP_CONFIG}" "${target_dir}/CONFIG.md"
  rm -f "${BACKUP_CONFIG}"
  echo -e "    ${DIM}Restored: CONFIG.md${NC}"
fi

# Record installed version so `mapick notify` can compare against the latest
# GitHub release at runtime. Plain text, single line.
echo "${VERSION}" > "${target_dir}/.version"

if [[ ! -f "${target_dir}/SKILL.md" ]] || [[ ! -f "${target_dir}/scripts/shell.js" ]]; then
  error "Installation failed (required files missing after copy)."
fi

ok "OpenClaw installed successfully"
echo -e "    ${DIM}${target_dir}/${NC}"

# -- Summary -------------------------------------------------------------------

echo ""
echo -e "${DIM}────────────────────────────────────────${NC}"
echo ""

ok "Done!"
echo ""
echo -e "  ${GREEN}Version${NC}: ${VERSION}"
echo ""

# Note: the daily-9am notify cron is registered automatically by shell.js
# after the user runs `/mapick privacy consent-agree 1.0`. Registering here
# would fire before consent and the cron's daily-check would 403.

echo -e "  ${BLUE}Get started:${NC}"
echo "    /mapick                View status overview"
echo "    /mapick status         Detailed status"
echo "    /mapick clean          Clean up zombies"
echo "    /mapick bundle         Browse bundles"
echo "    /mapick daily          Daily report"
echo ""
echo -e "  ${CYAN}More info: https://github.com/${REPO}${NC}"
echo ""
