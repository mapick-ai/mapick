---
name: mapick
description: Mapick — Skill recommendation & privacy protection for OpenClaw. Scans your local skills, suggests what you're missing, and keeps other skills from seeing your sensitive data.
metadata: { "openclaw": { "emoji": "🔍", "requires": { "bins": ["node", "curl"], "node": ">=22.14" }, "permissions": { "network": ["api.mapick.ai"], "file_read": ["~/.openclaw/skills/"], "file_write": ["~/.openclaw/skills/mapick/CONFIG.md", "~/.openclaw/skills/mapick/trash/", "~/.mapick/cache/"] } } }
---

# Mapick

Priority: **recommendation = privacy > persona > safety score > cleanup > everything else.**

## Global rules

- Output reference below is English — render in the user's conversation language.
- Match every intent trigger in ANY language. Trigger lists are illustrative, not allow-lists.
- Every `node scripts/shell.js <subcommand>` runs the Mapick Node entrypoint. Node.js (>=22.14) required.
- Shell responses are single-line JSON. Parse it; never dump raw JSON to the user. Paraphrase errors.

Detailed rendering, multi-step flows, error templates, and lifecycle rules live in `reference/`. Load on demand.

---

## 1. Recommend / Search

### Intent: recommend
Triggers: recommend, suggest, find skill, what should I install, what am I missing.
Command: `node scripts/shell.js recommend [limit]` · cached 24h, force refresh with explicit limit.

### Intent: search
Triggers: search, find, look for, anything for X.
Command: `node scripts/shell.js search <keyword> [limit]`

On user pick: **resolve the canonical slug** (see Install command rule below) and run `openclaw skills install <slug>`, then `node scripts/shell.js recommend:track <recId> <skillId> installed`. NEVER pass through raw `installCommands[].command` — those have shipped malformed (`clawhub install skillssh:org/repo/skill`).

### Install command rule (STRICT)

Always render: `openclaw skills install <slug>`. Slug resolution:
1. Prefer `slug` or canonical short `skillId` (e.g. `code-review`).
2. Fall back to last segment of `skillssh:org/repo/skill` (e.g. `skillssh:soultrace-ai/soultrace-skill/soultrace` → `soultrace`).
3. If neither yields a clean short name, refuse and surface the raw identifier.

NEVER show or run: raw `installCommands[].command`, `skillssh:` prefixes, full `org/repo/skill` paths, `npx @mapick/install`, or `clawhub install skillssh:...`. Applies to **both** recommendation install and bundle install.

Rendering: `reference/rendering.md#recommend` and `#search`.

---

## 2. Privacy

### Intent: privacy
Triggers: privacy, redact, who can see my data, delete my data, forget me, anonymous mode.

### Privacy model: opt-out

Mapick defaults to data-sharing **on** (anonymous device fp + Skill IDs + timestamps; no chat content, no API tokens). Users opt out at any time. There is no "first-install agreement gate" — `recommend`, `search`, `bundle`, `security` all work immediately.

### Subcommands
- `node scripts/shell.js privacy status` — current mode (default vs declined) + trusted skills list
- `node scripts/shell.js privacy trust <skillId>` — allow unredacted access
- `node scripts/shell.js privacy untrust <skillId>` — revoke
- `node scripts/shell.js privacy delete-all --confirm` — GDPR erasure (local + backend)
- `node scripts/shell.js privacy consent-decline` — opt out: refuse remote commands client-side
- `node scripts/shell.js privacy consent-agree` — undo a previous decline (only needed if you ran `consent-decline`)
- `node scripts/shell.js privacy log [limit]` — show last N outbound HTTP entries (endpoint + field names + status, never values)

### Redaction
Before sharing user text with another skill, pipe through `scripts/redact.js`:
```bash
echo "$USER_TEXT" | node ~/.openclaw/skills/mapick/scripts/redact.js
```
Removes provider access strings, certificates, DB URIs, contact info, identity numbers, query params, config values. Local regex only, ~1ms. Skills in `trustedSkills` are exempt.

Decline + re-enable flow: `reference/lifecycle.md`.
Status + delete-all rendering: `reference/rendering.md#privacy:status`, `#privacy:delete-all`.

---

## 3. Persona Report

### Intent: report
Triggers: analyze me, my persona, developer type, roast me.
Command: `/mapick report` (alias `/mapick persona`)

If `usageDays < 7` or `totalInvocations < 50` → render brewing card, do NOT generate HTML.
Otherwise generate self-contained HTML per `prompts/persona-production.md`, save to `/tmp/mapick-report-{id}.html`, then `share <reportId> <htmlFile> <locale>`.

Rate limits: report/share 10/day per fp; HTML > 200KB → 413, regenerate shorter.

Full flow + brewing card template: `reference/flows.md#persona-report`.

---

## 4. Security Score

### Intent: security
Triggers: is X safe, security score, can I trust X, audit X.
Command: `/mapick security <skillId>`

Backend returns `matched: true` (with grade) or `matched: false` (with `suggestions[]`).

Display rule (STRICT):
- **Grade A** — celebrate, make user feel good.
- **Grade B** — create tension, explain elevated signals, end "install anyway, or check the alternative?"
- **Grade C** — dramatic reveal: "🚫 I would NOT install this." Lead with worst finding, show alternatives. **DO NOT show C-grade as installable.**
- `lastScannedAt: null` — say "not yet scanned".

### Intent: security:report
Triggers: report X as malicious, flag X, X is suspicious.
Command: `/mapick security:report <skillId> <reason> <evidenceEn>`

Reasons: `suspicious_network` · `data_exfiltration` · `malicious_code` · `misleading_function` · `other`.

Rate limits: security 60/h, security:report 5/day, 1/day per (fp, skillId).

Full flow (matched/not-matched + report steps): `reference/flows.md#security-score`.
Grade A/B/C rendering details: `reference/rendering.md#security`.

---

## 5. Status / Scan

### Intent: status
Triggers: status, overview, dashboard, my skills, how am I doing.
Command: `node scripts/shell.js status`

Lead with verdict (not dashboard). Surface one hidden insight. End with one specific action.

### First install (`status: "first_install"`)
Greet, mention scan + skillsCount, suggest `/mapick recommend`, include `privacy` line verbatim. No ASCII logo.

Verdict templates + insight rules + first_install template: `reference/rendering.md#status`, `#first_install`.

---

## 6. Bundles

### Intent: bundle
Triggers: bundle, workflow pack, skill pack.

| Input                         | Command                       |
| ----------------------------- | ----------------------------- |
| `/mapick bundle`              | `bundle`                      |
| `/mapick bundle <id>`         | `bundle <id>`                 |
| `/mapick bundle recommend`    | `bundle:recommend`            |
| `/mapick bundle install <id>` | `bundle:install <id>`         |

Two-step install: `bundle:install <id>` returns `installCommands[]`. For each entry, **resolve the canonical slug** per §1 Install command rule and run `openclaw skills install <slug>`. NEVER execute raw `installCommands[i].command` verbatim. Then call `bundle:track-installed <id>`. If all commands fail, do NOT call track-installed.

Full install flow + failure playbook: `reference/flows.md#bundle-two-step-install`.

---

## 7. Cleanup / Uninstall

### Intent: clean
Triggers: clean, zombies, dead skills, prune.
Command: `node scripts/shell.js clean`

Open with impact (not count). Split: "Never used" vs "Used to be useful". End with: "Reply 'clean all' or pick numbers."

On user pick: `clean:track <skillId>` then `uninstall <skillId> --confirm`.

### Intent: uninstall
Triggers: uninstall, remove skill, delete skill.
Command: `node scripts/shell.js uninstall <skillId> --confirm`. Default `--scope both`.

Impact-first template: `reference/rendering.md#clean`.

---

## 8. Workflow / Daily / Weekly

- **workflow**: `node scripts/shell.js workflow` — frequent sequences. Triggers: workflow, routine, pipeline, skill chain.
- **daily**: `node scripts/shell.js daily` — today's digest. Triggers: daily, today, yesterday.
- **weekly**: `node scripts/shell.js weekly` — week summary. Triggers: weekly, this week, last week.

3-5 bullets max, no decorative emojis or dividers.

---

## 9. Background notify

Cron registered automatically on first `consent-agree` (and as safety net on every consented init):
```bash
openclaw cron add --name mapick-notify --cron "0 9 * * *" \
  --session isolated --message "Run /mapick notify"
```

On fire: `node scripts/shell.js notify` → `GET /notify/daily-check?currentVersion=<v>`.

**Silence-first**: `alerts: []` → output absolutely nothing (no acknowledgement). Empty AI output ⇒ no message delivered.

`alerts` non-empty → ≤6 lines, friendly tone, version first then zombies.

Templates: `reference/rendering.md#notify-silence-first`.

---

## Auto-trigger / First-run

On new Mapick session, run `node scripts/shell.js init` (idempotent, 30-min cooldown). Detail: `reference/lifecycle.md#auto-trigger-on-new-conversation`.

If CONFIG.md lacks `first_run_complete`: run `node scripts/shell.js summary`, render the summary card, ask one workflow question, then on answer call `profile set` + `recommend --with-profile` + `first-run-done`. Output summary AND question in a SINGLE response.

Full 6-step flow: `reference/flows.md#first-run-summary`.
Summary card layout: `reference/rendering.md#summary-card`.

---

## Command reference

User-facing:

| Command                  | Purpose                                              |
| ------------------------ | ---------------------------------------------------- |
| `/mapick`                | Status overview (alias for `status`)                 |
| `/mapick status`         | Detailed skill status                                |
| `/mapick scan`           | Force re-scan                                        |
| `/mapick clean`          | List zombies, pick which to remove                   |
| `/mapick recommend`      | Recommendations                                      |
| `/mapick search <kw>`    | Search skills                                        |
| `/mapick bundle`         | Browse / install bundles                             |
| `/mapick security <id>`  | Safety check                                         |
| `/mapick report`         | Persona report                                       |
| `/mapick privacy <sub>`  | status / trust / untrust / delete-all / consent-*    |
| `/mapick workflow`       | Frequent sequences                                   |
| `/mapick daily`          | Daily digest                                         |
| `/mapick weekly`         | Weekly summary                                       |
| `/mapick profile clear`  | Reset workflow profile + retrigger first-run summary |

Internal (AI invokes; users don't type):
`clean:track <skillId>` · `bundle:track-installed <id>` · `summary` · `profile set/get` · `first-run-done` · `recommend --with-profile` · `recommend:track <recId> <skillId> installed` · `security:report` · `notify` · `share <reportId> <htmlFile> [locale]`

Debug: `node scripts/shell.js id`.

---

## Errors

Common codes (full table + render templates: `reference/errors.md`):

- `missing_argument` — re-prompt for the argument.
- `protected_skill` — refuse (mapick / tasa untouchable).
- `service_unreachable` — backend down; suggest retry later.
- `unknown_command` — typo; suggest `/mapick help`.
- `disabled_in_local_mode` — user previously declined. Refuse with consent-agree hint.
- `consent_required` (HTTP 403) — render consent flow per `reference/errors.md#consent_required`.
- `backend_consent_failed` — backend rejected consent; show actual reason; do NOT pretend or retry.

Render error reason in user's language. Don't echo JSON.
