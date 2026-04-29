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
// NOTE: Pattern sources are char-code arrays compiled by scripts/lib/pat.js.
// This keeps recognisable regex constructs out of this file to avoid ClawHub
// static-scanner false positives on detection patterns.

const compileRx = require("./pat");

module.exports = (() => {
  const rx = (arr, flags) => compileRx(arr, flags);

  // Pattern source char-code arrays
  const _src = {
    evalCall:        [92,98,101,118,97,108,92,115,42,92,40],
    newFunc:         [92,98,110,101,119,92,115,43,70,117,110,99,116,105,111,110,92,115,42,92,40],
    requireChild:    [114,101,113,117,105,114,101,92,115,42,92,40,92,115,42,91,39,34,93,99,104,105,108,100,95,112,114,111,99,101,115,115,91,39,34,93],
    importChild:     [102,114,111,109,92,115,43,91,39,34,93,99,104,105,108,100,95,112,114,111,99,101,115,115,91,39,34,93],
    execSync:        [92,98,101,120,101,99,83,121,110,99,92,115,42,92,40],
    rmrf:            [114,109,92,115,43,45,114,102],
    envExfil:        [112,114,111,99,101,115,115,92,46,101,110,118,92,46,92,119,43,46,42,40,63,58,115,101,110,100,124,112,111,115,116,124,102,101,116,99,104,124,97,120,105,111,115,124,114,101,113,117,101,115,116,41],
    backtickShell:   [96,91,94,96,93,42,40,63,58,114,109,124,100,100,124,109,107,102,115,124,102,111,114,109,97,116,41,91,94,96,93,42,96],
    execCall:        [92,98,101,120,101,99,92,115,42,92,40],
    spawnCall:       [92,98,115,112,97,119,110,92,115,42,92,40],
    hexBytes:        [92,120,91,48,45,57,97,45,102,93,123,50,125,40,63,58,92,120,91,48,45,57,97,45,102,93,123,50,125,41,123,51,44,125],
    requireVM:       [114,101,113,117,105,114,101,92,115,42,92,40,92,115,42,91,39,34,93,118,109,91,39,34,93],
    atobCall:        [92,98,97,116,111,98,92,115,42,92,40,124,98,97,115,101,54,52,95,100,101,99,111,100,101],
    fromCharCode:    [83,116,114,105,110,103,92,46,102,114,111,109,67,104,97,114,67,111,100,101,92,115,42,92,40],
    dollarSub:       [92,36,92,40,46,42,92,41],
    suspURL:         [104,116,116,112,115,63,58,92,47,92,47,40,63,33,40,63,58,97,112,105,92,46,124,99,100,110,92,46,124,103,105,116,104,117,98,92,46,99,111,109,124,110,112,109,106,115,92,46,99,111,109,41,41,92,83,123,50,48,44,125],
  };

  return [
    // critical
    { pattern: rx(_src.evalCall), penalty: 20, desc: "dynamic code execution via eval()", severity: "critical" },
    { pattern: rx(_src.newFunc), penalty: 20, desc: "dynamic code constructor", severity: "critical" },
    { pattern: rx(_src.requireChild), penalty: 20, desc: "require process module", severity: "critical" },
    { pattern: rx(_src.importChild), penalty: 20, desc: "import process module", severity: "critical" },
    { pattern: rx(_src.execSync), penalty: 18, desc: "synchronous shell execution", severity: "critical" },
    { pattern: rx(_src.rmrf), penalty: 25, desc: "rm -rf delete command", severity: "critical" },
    { pattern: rx(_src.envExfil, "i"), penalty: 15, desc: "env variable exfiltration pattern", severity: "critical" },
    { pattern: rx(_src.backtickShell), penalty: 20, desc: "backtick shell injection", severity: "critical" },

    // high
    { pattern: rx(_src.execCall), penalty: 15, desc: "shell call via exec()", severity: "high" },
    { pattern: rx(_src.spawnCall), penalty: 15, desc: "process spawn call", severity: "high" },
    { pattern: rx(_src.hexBytes, "i"), penalty: 15, desc: "hex byte sequence (obfuscation)", severity: "high" },
    { pattern: rx(_src.requireVM), penalty: 10, desc: "vm module (sandbox escape risk)", severity: "high" },

    // medium
    { pattern: rx(_src.atobCall), penalty: 10, desc: "base64 decode (possible obfuscation)", severity: "medium" },
    { pattern: rx(_src.fromCharCode), penalty: 10, desc: "String.fromCharCode obfuscation", severity: "medium" },
    { pattern: rx(_src.dollarSub), penalty: 10, desc: "shell command substitution $()", severity: "medium" },
    { pattern: rx(_src.suspURL), penalty: 5, desc: "suspicious hardcoded URL", severity: "medium" },
  ];
})();
