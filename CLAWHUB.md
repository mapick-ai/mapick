# Mapick

The Skill manager for OpenClaw. Recommends what you're missing, cleans
what you don't use, blocks what's unsafe — without ever reading your
code or chat history.

```
openclaw skills install mapick
```

After install, talk to your agent in any language. Mapick auto-detects intent.

| Say | What you get |
| --- | --- |
| `recommend` | Personalized recommendations based on what you've already installed |
| `clean` · `zombies` | List of skills idle 30+ days, one reply to remove |
| `search <keyword>` | Live ClawHub search with safety grades |
| `is X safe?` · `security X` | Per-skill safety report; Grade-C skills surface safer alternatives |
| `analyze me` · `report` | Developer persona based on your usage pattern |
| `bundle` | Curated skill packs for a workflow (e.g. `fullstack-dev`) |

## Privacy at a glance

Mapick defaults to data-sharing **on**. Default install starts working immediately — no agreement gate.

**Sent**: anonymous device fingerprint (16-char hash of `hostname|os|home`) + Skill IDs you act on + timestamps.

**Never sent**: chat content, file contents, API tokens, credentials, Skill source, environment variables.

Three opt-outs, one command each:

- `node scripts/shell.js privacy consent-decline` — block all remote calls client-side
- `node scripts/shell.js privacy delete-all --confirm` — wipe local state + backend records
- `node scripts/shell.js privacy log` — show every outbound HTTP request from Mapick (endpoint, field names, status, duration; never values)

## What it touches

| Permission | Scope (declared in SKILL.md frontmatter, enforced in code) |
| --- | --- |
| Network | `api.mapick.ai` only — endpoint allowlist refuses any other URL |
| File read | `~/.openclaw/skills/`,`~/.openclaw/workspace/skills/` — scans installed Skills' SKILL.md |
| File write | `~/.openclawworkspace//skills/mapick/CONFIG.md`, `trash/`, `~/.mapick/cache/`, `~/.mapick/logs/` |
| Subprocess | `curl` (HTTPS, works around Nodejs); `node redact.js` (regex-only PII stripper, runs in subprocess for isolation); `openclaw cron` (registers the daily notify) |

## Trust signals

- **Outbound manifest** — every HTTP request is documented inline in
  [`scripts/lib/http.js`](scripts/lib/http.js) with method, endpoint, fields sent, and trigger.
  Single function (`httpCall`) is the only network exit; `grep httpCall\(` to audit.
- **Endpoint allowlist** — Mapick refuses to call any URL outside that
  manifest, even at runtime (returns `endpoint_not_allowed` and writes
  `blocked: true` to the audit log).
- **Redaction pre-flight** — every outbound payload is checked against
  20+ sensitive-pattern regex (`scripts/redact.js`) before sending.
  Trigger is logged with `redact_warning: true`; payload is not silently
  rewritten (avoids breaking API contracts).
- **Audit log** — `~/.mapick/logs/outbound.jsonl` records every request,
  rotates at 1MB. Read with `/mapick privacy log [N]`.
- **Skill uninstall** is two-step: `clean` only lists; `uninstall <id>`
  requires `--confirm`, refuses protected Skills (mapick / tasa), backs
  up to `trash/` first, auto-cleans backups older than 7 days.

## Requirements

- OpenClaw runtime with **Node.js 22.14+** (24 recommended; the OpenClaw runtime baseline)
- `curl`

No `jq`, no Mapick account, no separate Node install — OpenClaw provides the runtime.

## First conversation after install

The first message you send triggers `init` automatically. You'll see:

1. A quick scan of what you have installed
2. A summary card with what Mapick collected + 1-line privacy disclosure
3. One specific CTA — typically `clean` (if you have zombies) or `recommend` (if not)

No banner, no signup prompt, no consent gate.

## Source

[github.com/mapick-ai/mapick](https://github.com/mapick-ai/mapick) — issues + PRs welcome.

---

*Mapick is open source under MIT. The audit log + endpoint allowlist are
intentional self-constraints — Mapick refuses to expand its own attack
surface beyond what's declared in this file.*
