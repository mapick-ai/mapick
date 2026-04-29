# Mapick

The Skill manager for OpenClaw. Recommends what you're missing, cleans
what you don't use, blocks what's unsafe — without reading your project
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

Mapick defaults to data-sharing **on**. Default install starts working immediately — no agreement gate, no first-use consent prompt.

This is a **deliberate trade-off**, not an oversight. Mapick is the only
OpenClaw Skill that needs telemetry to do its core job (recommendations
based on what you have installed). A first-install consent gate has
been the single biggest UX drop-off point in past versions; users hit
"recommend" the second they install and bounce when they hit a wall.

**If you prefer opt-in**: run `node scripts/shell.js privacy consent-decline`
right after install. Local `status`, `scan`, `clean`, `uninstall`, and
privacy utilities keep working; remote recommendations, search, security,
reports, bundles, and share refuse client-side until you run
`consent-agree` to enable.

**Sent**: anonymous device fingerprint (16-char hash of `hostname|os|home`) + Skill IDs you act on + timestamps.

**Never sent**: chat content, arbitrary local file contents, API tokens, credentials, Skill source, environment variables.

**One thing that does upload to api.mapick.ai**: persona-share. When you ask
Mapick to "share my persona", it uploads a Mapick-generated
`/tmp/mapick-report-<id>.html` after fail-closed redaction. This is the
only path where an HTML payload (rather than just identifiers) leaves
your machine. Refuses upload if redaction is unavailable or disabled.

Three opt-outs, one command each:

- `node scripts/shell.js privacy consent-decline` — block all remote calls client-side
- `node scripts/shell.js privacy delete-all --confirm` — wipe local state + backend records
- `node scripts/shell.js privacy log` — show every outbound HTTP request from Mapick (endpoint, field names, status, duration; never values)

## What it touches

| Permission | Scope (declared in SKILL.md frontmatter, enforced in code) |
| --- | --- |
| Network | `api.mapick.ai` only — endpoint allowlist refuses any other URL |
| File read | `~/.openclaw/skills/` and `~/.openclaw/workspace/skills/` — scans every installed Skill's `SKILL.md` frontmatter to know what's there |
| File write | `~/.openclaw/workspace/skills/mapick/CONFIG.md`, `~/.openclaw/skills/mapick/trash/`, `~/.mapick/cache/`, `~/.mapick/logs/` |
| File copy on uninstall | When **you** run `uninstall <skillId> --confirm`, Mapick copies that one Skill's directory (the one being removed) into `trash/` so you can restore within 7 days. This is `fs.cpSync` on the Skill being removed — not on other Skills, not on your project files. |
| Runtime | Node.js only. Network uses built-in `fetch`; redaction runs in-process; no subprocess execution is required. |

## Trust signals

- **Outbound manifest** — every HTTP request is documented inline in
  [`scripts/lib/http.js`](scripts/lib/http.js) with method, endpoint, fields sent, and trigger.
  Single function (`httpCall`) is the only network exit; `grep httpCall\(` to audit.
- **Endpoint allowlist** — Mapick refuses to call any URL outside that
  manifest, even at runtime (returns `endpoint_not_allowed` and writes
  `blocked: true` to the audit log).
- **Redaction pre-flight** — every outbound JSON payload is checked against
  20+ sensitive-pattern regex (`scripts/redact.js`) before sending. If
  redaction is unavailable, upload is refused; if sensitive-looking values
  are found, only the redacted body is sent and `redacted_payload: true`
  is written to the audit log.
- **Persona share guardrails** — share accepts only regular, non-symlink
  `/tmp/mapick-report-<id>.html` files up to 200KB. Upload is refused if
  redaction fails or has been disabled.
- **Audit log** — `~/.mapick/logs/outbound.jsonl` records every request,
  rotates at 1MB. Read with `/mapick privacy log [N]`.
- **Skill uninstall** is two-step: `clean` only lists; `uninstall <id>`
  requires `--confirm`, refuses protected Skills (mapick / tasa), backs
  up to `trash/` first, auto-cleans backups older than 7 days.
- **Updates are detect-only** — Mapick checks for new versions of itself
  and your installed Skills, but **never installs, upgrades, removes, or
  modifies other Skills unless you explicitly confirm**. Every install /
  upgrade action surfaces a plan first (commands + what-it-does +
  what-it-doesn't + how-to-stop), and the AI runs it via its bash tool
  only after you reply "confirm". Mapick itself has zero subprocess
  execution. Disable detection entirely with
  `node scripts/shell.js update:settings off`.

## Requirements

- OpenClaw runtime with **Node.js 22.14+** (24 recommended; the OpenClaw runtime baseline)

No `jq`, no Mapick account, no separate Node install — OpenClaw provides the runtime.

## First conversation after install

The first message you send triggers `init` automatically. You'll see:

1. A quick scan of what you have installed (local — no network)
2. A summary card with what Mapick found + 1-line privacy disclosure
3. One specific CTA — typically `clean` (if you have zombies) or `recommend` (if not)

**Heads-up**: the auto-init flow makes **one** call to
`api.mapick.ai/assistant/status` to enrich the summary card with
`top_used` skills + per-grade safety counts. This is the first remote
call Mapick makes on your behalf, before you've typed any explicit
command. The body is your `device_fp`; nothing else.

If you want zero remote calls until **you** explicitly ask: run
`node scripts/shell.js privacy consent-decline` immediately after
install — before your first conversation. Local commands keep working;
remote commands refuse client-side. Re-enable any time with
`node scripts/shell.js privacy consent-agree`.

No banner, no signup prompt, no consent gate.

## Source

[github.com/mapick-ai/mapick](https://github.com/mapick-ai/mapick) — issues + PRs welcome.

---

*Mapick is open source under MIT. The audit log + endpoint allowlist are
intentional self-constraints — Mapick refuses to expand its own attack
surface beyond what's declared in this file.*
