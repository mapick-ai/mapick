# Changelog

All notable changes to Mapick will be documented in this file.

## v0.0.5 - 2026-04-28

### Reverted

- Drop `MAPICK_API_BASE` env-var support that was added in v0.0.4. `API_BASE` is hardcoded to `https://api.mapick.ai/api/v1` on purpose — the option was removed previously and shouldn't have come back.

## v0.0.4 - 2026-04-28

### Fixed

- `notify` was getting mapickii's release tag instead of mapick's because the backend default was hardcoded to `mapick-ai/mapickii`. mapick now sends `?repo=mapick-ai/mapick` on every `/notify/daily-check` call so the backend (post mapick-api PR #18) returns this Skill's actual latest release. Requires api.mapick.ai with mapick-api PR #18 deployed.

### Changed

- `API_BASE` now reads `MAPICK_API_BASE` env var (default still `https://api.mapick.ai/api/v1`). Was hardcoded; this matches mapickii's behavior and lets contributors point a local install at a dev backend without editing the script.

## v0.0.3 - 2026-04-28

### Fixed

- `httpCall()` switched from Node `https.request` to `curl` subprocess. Node 24 + macOS `https` throws `UNABLE_TO_VERIFY_LEAF_SIGNATURE` against valid TLS endpoints because Node's bundled CA store doesn't include the intermediate certs the system keychain trusts; `--use-system-ca` doesn't reliably bridge it on 24.x. curl uses the OS trust store directly. Symptom this fixes: every `mapick` backend call (notify, recommend, consent-agree, etc.) was silently failing the SSL handshake → notify always returned empty alerts, consent-agree never persisted server-side. `curl` is already declared in SKILL.md `requires.bins`, so no new dependency.

## v0.0.2 - 2026-04-28

### Fixed

- `notify` cron registration was documented in SKILL.md §9 and `install.sh` notes ("Cron registered automatically on first `consent-agree` (and as safety net on every consented init)") but the actual code was missing — fresh installs never got a cron job, leaving `/notify/daily-check` callable manually but never fired automatically. Added `registerNotifyCron()` to `shell.js` (idempotent: `cron rm` then `cron add`) and wired it into:
  - `privacy consent-agree` (after the backend POST succeeds — first-time registration)
  - `init` when `hasConsent(config)` is true (safety net — recovers from manually deleted crons or installs that ran before openclaw was on PATH)

## v0.0.1 - 2026-04-28

First public release of Mapick — the Mapick ecosystem butler.

### Supported platform

- OpenClaw (`~/.openclaw/skills/mapick/`)
