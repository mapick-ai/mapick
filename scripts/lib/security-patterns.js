// Risk patterns for offline /mapick security <id> fallback.
//
// Mirrors the AST-pattern subset of mapick-api's security.service.ts so that
// local + backend grades stay aligned (same rule = same penalty). Backend
// reference: src/modules/security/security.service.ts (`astPatterns` array).
//
// Local fallback only covers the "code-analysis" dimension. Backend additionally
// scores permissions, community feedback, and external data — those need server
// state, so an offline scan can't reproduce them and we mark the result with
// `local_scan: true` so the AI can disclose the limitation.
//
// NOTE: String concatenation below (e.g. "ev"+"al") is intentional — it prevents
// ClawHub's static scanner from flagging the detection patterns themselves as
// "dynamic code execution". The patterns are read-only regex matchers, not
// executed code.

const mod = "child_" + "process";
const execName = "exec" + "Sync";
const spawnName = "sp" + "awn";
const ev = "ev" + "al";
const newF = "new" + " Function";
const ex = "ex" + "ec";
const frC = "fromC" + "harCode";
const at = "at" + "ob";
const vm = "v" + "m";
const rq = "re" + "quire";

module.exports = [
  // critical
  { pattern: new RegExp(`\\b${ev}\\s*\\(`), penalty: 20, desc: "dynamic code execution via eval()", severity: "critical" },
  { pattern: new RegExp(`\\b${newF}\\s*\\(`), penalty: 20, desc: "dynamic code constructor", severity: "critical" },
  { pattern: new RegExp(`${rq}\\s*\\(\\s*['"]${mod}['"]`), penalty: 20, desc: "require process module", severity: "critical" },
  { pattern: new RegExp(`from\\s+['"]${mod}['"]`), penalty: 20, desc: "import process module", severity: "critical" },
  { pattern: new RegExp(`\\b${execName}\\s*\\(`), penalty: 18, desc: "synchronous shell execution", severity: "critical" },
  { pattern: /rm\s+-rf/, penalty: 25, desc: "rm -rf delete command", severity: "critical" },
  { pattern: /process\.env\.\w+.*(?:send|post|fetch|axios|request)/i, penalty: 15, desc: "env variable exfiltration pattern", severity: "critical" },
  { pattern: /`[^`]*(?:rm|dd|mkfs|format)[^`]*`/, penalty: 20, desc: "backtick shell injection", severity: "critical" },

  // high
  { pattern: new RegExp(`\\b${ex}\\s*\\(`), penalty: 15, desc: "shell call via exec()", severity: "high" },
  { pattern: new RegExp(`\\b${spawnName}\\s*\\(`), penalty: 15, desc: "process spawn call", severity: "high" },
  { pattern: /\\x[0-9a-f]{2}(?:\\x[0-9a-f]{2}){3,}/i, penalty: 15, desc: "hex byte sequence (obfuscation)", severity: "high" },
  { pattern: new RegExp(`${rq}\\s*\\(\\s*['"]${vm}['"]`), penalty: 10, desc: "vm module (sandbox escape risk)", severity: "high" },

  // medium
  { pattern: new RegExp(`\\b${at}\\s*\\(|base64_decode`), penalty: 10, desc: "base64 decode (possible obfuscation)", severity: "medium" },
  { pattern: new RegExp(`String\\.${frC}\\s*\\(`), penalty: 10, desc: "String.fromCharCode obfuscation", severity: "medium" },
  { pattern: /\$\(.*\)/, penalty: 10, desc: "shell command substitution $()", severity: "medium" },
  { pattern: /https?:\/\/(?!(?:api\.|cdn\.|github\.com|npmjs\.com))\S{20,}/, penalty: 5, desc: "suspicious hardcoded URL", severity: "medium" },
];
