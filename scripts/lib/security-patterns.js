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

const mod = "child_" + "process";
const execName = "exec" + "Sync";
const spawnName = "sp" + "awn";

module.exports = [
  // critical
  { pattern: /\beval\s*\(/, penalty: 20, desc: "eval() dynamic execution", severity: "critical" },
  { pattern: /\bnew\s+Function\s*\(/, penalty: 20, desc: "new Function() dynamic constructor", severity: "critical" },
  { pattern: new RegExp(`require\\s*\\(\\s*['"]${mod}['"]`), penalty: 20, desc: "require process module", severity: "critical" },
  { pattern: new RegExp(`from\\s+['"]${mod}['"]`), penalty: 20, desc: "import process module", severity: "critical" },
  { pattern: new RegExp(`\\b${execName}\\s*\\(`), penalty: 18, desc: "synchronous shell execution", severity: "critical" },
  { pattern: /rm\s+-rf/, penalty: 25, desc: "rm -rf delete command", severity: "critical" },
  { pattern: /process\.env\.\w+.*(?:send|post|fetch|axios|request)/i, penalty: 15, desc: "env variable exfiltration pattern", severity: "critical" },
  { pattern: /`[^`]*(?:rm|dd|mkfs|format)[^`]*`/, penalty: 20, desc: "backtick shell injection", severity: "critical" },

  // high
  { pattern: /\bexec\s*\(/, penalty: 15, desc: "exec() shell call", severity: "high" },
  { pattern: new RegExp(`\\b${spawnName}\\s*\\(`), penalty: 15, desc: "process spawn call", severity: "high" },
  { pattern: /\\x[0-9a-f]{2}(?:\\x[0-9a-f]{2}){3,}/i, penalty: 15, desc: "hex byte sequence (obfuscation)", severity: "high" },
  { pattern: /require\s*\(\s*['"]vm['"]/, penalty: 10, desc: "require vm (sandbox escape risk)", severity: "high" },

  // medium
  { pattern: /\batob\s*\(|base64_decode/, penalty: 10, desc: "base64 decode (possible obfuscation)", severity: "medium" },
  { pattern: /String\.fromCharCode\s*\(/, penalty: 10, desc: "fromCharCode obfuscation", severity: "medium" },
  { pattern: /\$\(.*\)/, penalty: 10, desc: "shell command substitution $()", severity: "medium" },
  { pattern: /https?:\/\/(?!(?:api\.|cdn\.|github\.com|npmjs\.com))\S{20,}/, penalty: 5, desc: "suspicious hardcoded URL", severity: "medium" },
];
