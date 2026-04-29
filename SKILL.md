---
name: mapick
description: Mapick — Skill recommendation & privacy protection for OpenClaw. Scans your local skills, suggests what you're missing, and keeps other skills from seeing your sensitive data.
metadata: { "openclaw": { "emoji": "🔍", "requires": { "bins": ["node"], "node": ">=22.14" }, "permissions": { "network": ["api.mapick.ai"], "file_read": ["~/.openclaw/skills/","~/.openclaw/workspace/skills/"], "file_write": ["~/.openclaw/workspace/skills/mapick/CONFIG.md", "~/.openclaw/skills/mapick/trash/", "~/.mapick/cache/"] } } }
---

# Mapick

Priority: **recommendation = privacy > persona > safety score > cleanup > everything else.**

## Global rules

- Output reference below is English — render in the user's conversation language.
- Match every intent trigger in ANY language. Trigger lists are illustrative, not allow-lists.
- Every `node scripts/shell.js <subcommand>` runs the Mapick Node entrypoint. Node.js (>=22.14) required.
- Shell responses are single-line JSON. Parse it; never dump raw JSON to the user. Paraphrase errors.
- For slash commands, never narrate internal preparation. Do not tell the user
  you are reading SKILL.md, loading reference files, checking handlers, or
  deciding which tool to call. Run the command and render only the final
  user-facing result.

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

### Rendering: recommend / search

Filter `score < 0.4`. Show **3 items max**. For each item render exactly **two sentences** — no tables, no bulleted field lists:

1. **Sentence 1 — the gap**: one concrete thing the user does manually today. Reference something they said, installed, or do. ("You merge ~12 PRs a week and review them by eyeballing the diff.")
2. **Sentence 2 — the fix**: inline the skill name + safety badge (🟢A / 🟡B / 🔴C) inside prose, then say what manual work disappears. ("Code Review 🟢A turns that into one comment per blocker.")

Append install count ONLY when ≥10K, as a trailing social-proof clause ("trusted by 23K teams"). Never as a separate field. Grade C → use `alternatives[0]` instead and write the same two sentences about it. Open with a problem statement, not a catalog. Close with: "These three close your <area> loop. Reply 1 / 2 / 3 to install, or 'install all'."

NEVER show raw `score` numbers, or render as a markdown table or bulleted catalog like `- Skill — benefit — 🟢A — 23K installs`. The user should feel "this is for ME", not "here are some products".

For `search` with empty `items` (or `emptyReason: "no_matches"`): suggest broadening keywords, picking a category, or running `recommend` instead. Otherwise render like `recommend` (3-5 items max).

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
Before sharing user text with another skill, call the local `scripts/redact.js`
module or CLI and use only the redacted output.
Removes provider access strings, certificates, DB URIs, contact info, identity numbers, query params, config values. Local regex only, ~1ms. Skills in `trustedSkills` are exempt.

Decline + re-enable flow: `reference/lifecycle.md`.
Status + delete-all rendering: `reference/rendering.md#privacy:status`, `#privacy:delete-all`.

---

## 3. Persona Report

### Intent: report
Triggers: analyze me, my persona, developer type, roast me.
Command: `node scripts/shell.js report` (alias `/mapick persona`)

Do not narrate tool selection, reference loading, or internal checks. Call the
report command directly and render only the final card or final user-facing
error. Never include phrases like "let me check", "according to SKILL.md", or
raw tool reasoning.

If `usageDays < 7` or `totalInvocations < 50` → render brewing card, do NOT generate HTML.
Otherwise generate self-contained HTML per `prompts/persona-production.md`, save only to `/tmp/mapick-report-{id}.html`, then `share <reportId> /tmp/mapick-report-{id}.html <locale>`. Never pass any other local file path to `share`.

Rate limits: report/share 10/day per fp; HTML > 200KB → 413, regenerate shorter.

Full flow + brewing card template: `reference/flows.md#persona-report`.

---

## 4. Security Score

### Intent: security
Triggers: is X safe, security score, can I trust X, audit X.
Command: `/mapick security <skillId>`

Backend returns `matched: true` (with grade) or `matched: false` (with `suggestions[]`).

Display rule (STRICT):
- **Grade A** — celebrate. "✅ Clean bill of health. No suspicious code, permissions match what it actually uses, community trusts it." Make user feel good.
- **Grade B** — create tension. "⚠️ Not a dealbreaker, but worth knowing..." Explain what specific signals are elevated. ("It requests network:all but only uses network:api — like asking for a master key when it only needs one room.") End: "Install anyway, or check the alternative?"
- **Grade C** — **dramatic reveal.** "🚫 I would NOT install this." Lead with worst finding first (eval(), rm -rf, data exfil pattern). Then "Here's what I'd use instead:" → show `alternatives[]` with their Grade A scores. **DO NOT show the C-grade skill as installable.**
- `lastScannedAt: null` — "⚠️ This skill hasn't been scanned yet. That doesn't mean it's bad — nobody's checked. Proceed with caution or wait for a scan."
- `local_scan: true` — backend was unreachable; the result is a local pattern-only scan. Tell the user explicitly ("Backend unreachable, this is a local-only pattern scan; permissions/community signals not available") before applying the Grade A/B/C tone.

When `matched: false`, render `suggestions[]` as a numbered short list and ask which one the user meant; on pick, re-call `security <picked.skillId>`.

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

### Intent: diagnose
Triggers: diagnose, version, loaded path, why old version, shadow, duplicate.
Command: `node scripts/shell.js diagnose`

Do not inspect unrelated directories or narrate investigation. Render only the
JSON returned by `diagnose`: version, loaded directory, duplicate workspace
skill, shadow risk, and fix hint. No preamble.

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

### Rendering: clean

1. **Open with impact, not count.** Not "Found N zombie skills" but: "Your agent is carrying N dead skills. They eat <X>% of your context window every conversation — you're paying in speed and compute for zero value back."
2. **Split into two groups:**
   - "Never used (why did you install these?):" — 0 calls. Show install date: "installed 61 days ago, never once used".
   - "Used to be useful:" — calls but idle 30+ days. Show last use date: "last used 47 days ago".
3. **Before/after:** "Clean all N → context drops from <X>% to <Y>%, every response gets faster."
4. **Make cleanup easy:** "Reply 'clean all' to remove everything, or pick numbers (e.g. '1-8 15 17')."

Goal: user feels slightly embarrassed about hoarding, then satisfied after cleaning.

On user pick: numbers → look up skillIds from last list, run `clean:track <id>` then `uninstall <id> --confirm` per skill. `all` → apply to every zombie. `skip` → reply "ok". Reason is `zombie_cleanup` (server-side); do NOT ask the user for one.

`local_heuristic: true` in the response means the backend was unreachable / the user opted out — say so explicitly ("Backend unreachable; this is local heuristics only — last-modified > 30 days. Backend usage data not available").

### Intent: uninstall
Triggers: uninstall, remove skill, delete skill.
Command: `node scripts/shell.js uninstall <skillId> --confirm`. Default `--scope both`.

---

## 8. Workflow / Daily / Weekly

- **workflow**: `node scripts/shell.js workflow` — frequent sequences. Triggers: workflow, routine, pipeline, skill chain.
- **daily**: `node scripts/shell.js daily` — today's digest. Triggers: daily, today, yesterday.
- **weekly**: `node scripts/shell.js weekly` — week summary. Triggers: weekly, this week, last week.

3-5 bullets max, no decorative emojis or dividers.

---

## 9. Background notify

Background notify is checked by `/mapick notify`. Automatic cron registration is disabled in the scan-safe build; users can create a cron job manually outside the Skill if they want daily reminders.

On fire/manual run: `node scripts/shell.js notify` → `GET /notify/daily-check?currentVersion=<v>`.

**Silence-first**: `alerts: []` → output absolutely nothing (no acknowledgement). Empty AI output ⇒ no message delivered.

`alerts` non-empty → ≤6 lines, friendly tone, version first then zombies.

Templates: `reference/rendering.md#notify-silence-first`.

---

## Auto-trigger / First-run

On new Mapick session, run `node scripts/shell.js init` (idempotent, 30-min cooldown). Detail: `reference/lifecycle.md#auto-trigger-on-new-conversation`.

If CONFIG.md lacks `first_run_complete`: run `node scripts/shell.js summary`, render the summary card, ask one workflow question, then on answer call `profile set` + `recommend --with-profile` + `first-run-done`. Output summary AND question in a SINGLE response.

### Rendering: summary card

```
mapick: 📊 Scan complete. Here's what I found.

🔒 Privacy
Your redaction engine is live — <privacy_rules> rules active.
Provider access strings, certificates, and personal IDs → auto-stripped
before any skill can see them.

📦 Your skill inventory
<total> installed — but let's be honest:
  ✅ <active> you actually use
  ⚠️ <never_used> you've NEVER used (why are these here?)
  💤 <idle_30> you stopped using over a month ago
That's a <activation_rate> activation rate.

🔥 Your heavy hitters
1. <top_used[0].name>      <top_used[0].daily>x/day — your workhorse
2. <top_used[1].name>      <top_used[1].daily>x/day
3. <top_used[2].name>      <top_used[2].daily>x/day

🛡️ Safety check
<security.A> skills passed (Grade A)
<security.B> flagged minor issues (Grade B)
<security.C> I wouldn't trust (Grade C) — say "security <name>" to see why

⚡ The bottom line
<zombie_count> zombie skills are eating <context_waste_pct>% of your
context window. Every conversation, your agent loads them for nothing.

🔒 Outbound: anonymous device id + skill IDs you act on + timestamps.
   Audit: /mapick privacy log    Decline: /mapick privacy decline
```

If `never_used == 0 && idle_30 == 0`: skip negativity → "Clean setup. Top 10%." If `total <= 3`: skip the zombie angle → "Just getting started — let me find tools that match your workflow." If `has_backend: false`: skip the heavy-hitters + safety-check sections; say "Backend offline; counts only."

Full 6-step flow: `reference/flows.md#first-run-summary`.

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
| `/mapick diagnose`       | Show loaded version/path and workspace shadow risks  |

Internal (AI invokes; users don't type):
`clean:track <skillId>` · `bundle:track-installed <id>` · `summary` · `profile set/get` · `first-run-done` · `recommend --with-profile` · `recommend:track <recId> <skillId> installed` · `security:report` · `notify` · `share <reportId> <htmlFile> [locale]`

Debug: `node scripts/shell.js id`, `node scripts/shell.js diagnose`.

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
