# Changelog

All notable changes to Mapick will be documented in this file.

## v0.0.2 - 2026-04-28

### Fixed

- `notify` cron registration was documented in SKILL.md §9 and `install.sh` notes ("Cron registered automatically on first `consent-agree` (and as safety net on every consented init)") but the actual code was missing — fresh installs never got a cron job, leaving `/notify/daily-check` callable manually but never fired automatically. Added `registerNotifyCron()` to `shell.js` (idempotent: `cron rm` then `cron add`) and wired it into:
  - `privacy consent-agree` (after the backend POST succeeds — first-time registration)
  - `init` when `hasConsent(config)` is true (safety net — recovers from manually deleted crons or installs that ran before openclaw was on PATH)

## v0.0.1 - 2026-04-28

First public release of Mapick — the Mapick ecosystem butler.

### Supported platform

- OpenClaw (`~/.openclaw/skills/mapick/`)
