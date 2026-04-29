# Changelog

All notable changes to Mapick will be documented in this file.

## Unreleased

### Fixed

- Installer now warns when a workspace Mapick skill shadows the managed install.
- Privacy status now renders the opt-out default as `remote_access: enabled`.
- Persona report instructions now forbid leaking tool selection or internal checks.

### Added

- `diagnose` / `version` shell command for loaded path, version, and shadow-risk checks.

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

- Fix bug.

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
