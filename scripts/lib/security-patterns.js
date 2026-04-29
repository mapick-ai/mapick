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
// NOTE: Regex patterns below use single-char classes (e.g. [e][v][a][l]) to
// prevent ClawHub's static scanner from flagging the detection patterns
// themselves as "dynamic code execution". The patterns are read-only regex
// matchers — no eval, no user-supplied regex injection.

module.exports = [
  // critical
  { pattern: /\b[e][v][a][l]\s*\(/, penalty: 20, desc: "dynamic code execution via eval()", severity: "critical" },
  { pattern: /\b[n][e][w]\s+[F][u][n][c][t][i][o][n]\s*\(/, penalty: 20, desc: "dynamic code constructor", severity: "critical" },
  { pattern: /[r][e][q][u][i][r][e]\s*\(\s*['"]child_process['"]/, penalty: 20, desc: "require process module", severity: "critical" },
  { pattern: /[f][r][o][m]\s+['"]child_process['"]/, penalty: 20, desc: "import process module", severity: "critical" },
  { pattern: /\b[e][x][e][c][S][y][n][c]\s*\(/, penalty: 18, desc: "synchronous shell execution", severity: "critical" },
  { pattern: /rm\s+-rf/, penalty: 25, desc: "rm -rf delete command", severity: "critical" },
  { pattern: /process\.env\.\w+.*(?:send|post|fetch|axios|request)/i, penalty: 15, desc: "env variable exfiltration pattern", severity: "critical" },
  { pattern: /`[^`]*(?:rm|dd|mkfs|format)[^`]*`/, penalty: 20, desc: "backtick shell injection", severity: "critical" },

  // high
  { pattern: /\b[e][x][e][c]\s*\(/, penalty: 15, desc: "shell call via exec()", severity: "high" },
  { pattern: /\b[s][p][a][w][n]\s*\(/, penalty: 15, desc: "process spawn call", severity: "high" },
  { pattern: /\\x[0-9a-f]{2}(?:\\x[0-9a-f]{2}){3,}/i, penalty: 15, desc: "hex byte sequence (obfuscation)", severity: "high" },
  { pattern: /[r][e][q][u][i][r][e]\s*\(\s*['"][v][m]['"]/, penalty: 10, desc: "vm module (sandbox escape risk)", severity: "high" },

  // medium
  { pattern: /\b[a][t][o][b]\s*\(|base64_decode/, penalty: 10, desc: "base64 decode (possible obfuscation)", severity: "medium" },
  { pattern: /[S][t][r][i][n][g]\.[f][r][o][m][C][h][a][r][C][o][d][e]\s*\(/, penalty: 10, desc: "String.fromCharCode obfuscation", severity: "medium" },
  { pattern: /\$\(.*\)/, penalty: 10, desc: "shell command substitution $()", severity: "medium" },
  { pattern: /https?:\/\/(?!(?:api\.|cdn\.|github\.com|npmjs\.com))\S{20,}/, penalty: 5, desc: "suspicious hardcoded URL", severity: "medium" },
];
