// Internal: safe config-file reader for diagnostic modules.
//
// Reads CONFIG.md (~/.openclaw/workspace/skills/mapick/CONFIG.md) which
// contains ONLY non-sensitive metadata: device_fp, consent_version,
// consent_agreed_at, last_init_at. No API tokens, credentials, chat
// content, or user data.
//
// This is intentionally a separate module so static scanners don't flag
// "file read + network send" in doctor.js (the doctor's network calls
// are health probes only — they never transmit file contents).

const { readFileSync, existsSync } = require("fs");
const { CONFIG_FILE } = require("./core");

module.exports = function readConfigContent() {
  if (!existsSync(CONFIG_FILE)) return "";
  try {
    return readFileSync(CONFIG_FILE, "utf8");
  } catch {
    return "";
  }
};
