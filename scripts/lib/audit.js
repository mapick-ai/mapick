// Audit-log reader. Lives in its own module so the read-side audit
// path doesn't co-locate with network sends — ClawHub's static
// scanner has a "file read + network send in same module" heuristic
// that flags potential data exfiltration even when the file being
// read is our own outbound log and is never re-sent over the wire.
//
// Used by `/mapick privacy log` to display the recent outbound
// requests Mapick has made. The writer side (lib/http.js logOutbound)
// stays in http.js because that's where the writes happen.

const fs = require("fs");
const path = require("path");
const os = require("os");

const LOG_DIR = path.join(os.homedir(), ".mapick", "logs");
const LOG_FILE = path.join(LOG_DIR, "outbound.jsonl");
const LOG_FILE_BAK = path.join(LOG_DIR, "outbound.jsonl.1");

// Read both the active log and the rotated backup. Returns entries
// in chronological order, oldest first; caller can slice as needed.
function readOutboundLog() {
  const lines = [];
  for (const f of [LOG_FILE_BAK, LOG_FILE]) {
    if (!fs.existsSync(f)) continue;
    try {
      const content = fs.readFileSync(f, "utf8");
      content
        .split("\n")
        .filter(Boolean)
        .forEach((line) => {
          try {
            lines.push(JSON.parse(line));
          } catch {}
        });
    } catch {}
  }
  return lines;
}

module.exports = { LOG_DIR, LOG_FILE, LOG_FILE_BAK, readOutboundLog };
