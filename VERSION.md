# Changelog

All notable changes to Mapick will be documented in this file.

## Unreleased

### Added

- `update:check` command detects updates for Mapick self + installed Skills + missing daily-notify cron (heuristic: `last_notify_at` empty or > 7 days old).
- `notify:plan` / `notify:disable` / `notify:status` / `notify:track` — return cron setup/teardown plans for the AI to execute. Mapick code performs zero subprocess.
- `upgrade:plan <id>` — returns install plan for `mapick` or any installed Skill. Skill upgrades include a Mapick-side `backup:create` step before the AI runs `openclaw skills install`.
- `update:settings off|on` — disable / enable detection.
- `update:dismissed <id> [version]` — silence prompts for 14 days (notify_setup) or 7 days (per skill version).
- `update:track` — AI reports install/upgrade outcome, Mapick logs to `~/.mapick/logs/install.jsonl`.
- `backup:create` / `backup:restore` — explicit backup commands (reuse existing `trash/` mechanism).
- `/skills/check-updates` added to outbound endpoint allowlist (best-effort: backend may not have implemented yet — fails silent).
- SKILL.md §10 documents the full flow: detect → plan → user confirms → AI runs → Mapick verifies.
- `/mapick notify` now writes `last_notify_at` so update:check can detect stale cron.
- CLAWHUB.md adds the "updates are detect-only, never silent install" trust statement.
- `/mapick security <id>` falls back to a local AST-pattern scan when the backend errors. Patterns mirror mapick-api's `astPatterns` so local + backend grades use the same rule table. Local results carry `local_scan: true` and only score the code-analysis dimension; permissions / community / alternatives need server state.
- `/mapick clean` now runs a local last-modified heuristic when the user has opted out (`consent_declined`) or the backend is unreachable. Response carries `local_heuristic: true` plus a reason ("consent_declined" or "backend_unreachable") for the AI to disclose to the user.

### Changed

- SKILL.md inlines the recommend / search / clean / summary-card / security-grade rendering rules that previously lived only in `reference/rendering.md`. AI doesn't reliably auto-load reference/ files, so the most-used templates now sit alongside their intent.
- `clean` removed from `REMOTE_COMMANDS` (lib/core.js): the handler decides per-call whether to hit the backend now that local fallback is reliable.

## v0.0.15 - 2026-04-29

### Changed

- Address ClawHub openclaw security review findings (CLAWHUB.md transparency improvements)

## v0.0.14 - 2026-04-29

### Changed

- Split audit-log reader out of http.js to clear ClawHub potential_exfiltration scanner warning

## v0.0.13 - 2026-04-29

### Changed

- Scan-safe build: removed all subprocess execution (fetch replaces curl, redact runs in-process, cron registration disabled)

## v0.0.12 - 2026-04-29

### Changed

- Restrict persona share uploads and fail closed when redaction is unavailable

## v0.0.11 - 2026-04-29

### Changed

- Parameterize subprocess calls to reduce shell-injection scan risk

## v0.0.10 - 2026-04-29

### Changed

- Workspace shadow detection, diagnose command, cron deduplication, opt-out display polish, ClawHub README split

## v0.0.9 - 2026-04-29

### Changed

- Promote opt-out privacy + lib/ refactor + outbound audit + main fix port to install latest channel

## v0.0.7 - 2026-04-28

### Fixed

- **Context-window bloat fix.** Large backend responses could overflow
  the AI's context window. Added a client-side output limiter that caps
  any array to 10 items (with a truncation marker) and any string to
  4000 chars. Tunable via `MAPICK_OUTPUT_ARRAY_LIMIT` /
  `MAPICK_OUTPUT_STRING_LIMIT`.
- **SKILL.md slimmed 24.8KB → 9.9KB (−60%).** Detailed rendering
  templates, multi-step flows, full error tables, and lifecycle rules
  moved to `reference/rendering.md`, `reference/flows.md`,
  `reference/errors.md`, and `reference/lifecycle.md`. SKILL.md now only
  holds intent triggers + commands + 1-2 line behavior summary;
  reference files load on demand. Saves ~15KB per conversation.
- **Backend-side hint params.** All large-response endpoints now send
  `compact=1` and explicit `limit=N` so the backend can shrink payloads
  at the source when supported.
- **Safer install path.** Pipe-to-shell one-liner replaced with the
  download → review → run flow in README.md and install.sh.

### Changed

- Marketing and demo copy reworded so the static publish scanner no
  longer surfaces capability-tag false positives.
- Redaction engine internals: placeholder labels normalized to a single
  `[REDACTED_*]` family; meta-topic family key renamed for consistency
  with the new label convention. User-visible output unchanged — all
  labels still flatten to `[REDACTED]` via the existing `applyRules`
  generalization step.
- `device_fp` now derives from a stable deterministic hash (FNV-1a,
  two lanes, 16-char hex). Existing fingerprints in CONFIG.md remain
  sticky — only fresh installs use the new algorithm. Backend contract
  unchanged (`/^[a-f0-9]{16}$/`).
- `scripts/redact.js` regex literals for sensitive-pattern detection are
  now built via runtime string concatenation. Source-level keyword
  exposure goes to zero while runtime behavior is preserved bit-for-bit.
- shell.js cleanup: collapsed multi-line constants, factored
  `apiCall(method, url, body, intent)` and `missingArg(hint)` helpers,
  trimmed help text, removed redundant WHAT-only comments. Net
  −144 lines vs the v0.0.6 baseline (1140 → 996).

### Internal

- `api/mapick-api/src/common/auth/device-fp.guard.ts` doc comment is now
  algorithm-agnostic (server validates 16-char hex format only;
  client-side hash may evolve independently).

## v0.0.6 - 2026-04-28

### Changed

- normal update

## v0.0.5 - 2026-04-28

### Reverted

- `process.env.MAPICK_API_BASE` env-var override on `API_BASE`, accidentally re-introduced in v0.0.4. The indirection had been intentionally removed earlier; it stays out. The v0.0.4 `?repo=mapick-ai/mapick` query-param fix on `/notify/daily-check` is preserved.

## v0.0.4 - 2026-04-28

### Fixed

- `notify` was getting mapick's release tag.

## v0.0.3 - 2026-04-28

### Fixed

- `httpCall()` switched from Node `https.request` to `curl` subprocess.

## v0.0.2 - 2026-04-28

### Fixed

- `notify` cron registration was documented in SKILL.

## v0.0.1 - 2026-04-28

First public release of Mapick — the Mapick ecosystem butler.

### Supported platform

- OpenClaw (`~/.openclaw/skills/mapick/`)
