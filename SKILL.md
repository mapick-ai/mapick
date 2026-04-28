---
name: mapick
description: Mapick — Skill recommendation & privacy protection for OpenClaw. Scans your local skills, suggests what you're missing, and keeps other skills from seeing your secrets.
metadata: { "openclaw": { "emoji": "🔍", "requires": { "bins": ["node", "jq", "curl"] } } }
---

# Mapick

Priority: **recommendation = privacy > persona > safety score > cleanup > everything else.**

## Global rules

- All command output below is **English reference** — render in the user's conversation language.
- **Match every intent trigger in ANY language** (recognize equivalents in whatever the user speaks). Trigger lists below are illustrative, not allow-lists.
- Every `bash shell <subcommand>` execs `scripts/shell` → `node shell.js`. Node.js is required.
- Shell responses are single-line JSON. Parse it; never dump raw JSON to the user (except explicit debug). Paraphrase errors in the user's language.

---

## 1. Recommendation & Discovery

### Intent: recommend
Triggers: recommend, suggest, find skill, what should I install, what am I missing. Only treat as `recommend` when the user asks about **skills/tools/installs** (not "recommend a book").
Command: `bash shell recommend [limit]` · Backend: `GET /recommendations/feed?limit=5` (60/h)

### Intent: search
Triggers: search, find, look for, anything for X.
Command: `bash shell search <keyword> [limit]` · Backend: `GET /skill/live-search` (30/min)

### Rendering (recommend)

When shell returns `{ intent: "recommend", items: [...] }`:

1. **Filter `score < 0.4`** — too weak to surface.
2. **Open with a problem statement**, not a catalog. Say what GAP the user has, not "I found N skills":
   "You have github but no review tool — your PRs are all manual."
   If no profile exists, infer from installed skills.
3. **Show 3 items max.** For each, render exactly TWO sentences — no tables, no bulleted field lists:
   - **Sentence 1 — the gap**: one concrete thing the user does manually today. Reference something they said, installed, or do. ("You merge ~12 PRs a week and review them by eyeballing the diff.")
   - **Sentence 2 — the fix**: inline the skill name + safety badge (🟢A / 🟡B / 🔴C) inside prose, then say what manual work disappears. ("Code Review 🟢A turns that into one comment per blocker.")
   - Append install count ONLY when ≥10K, as a trailing social-proof clause ("trusted by 23K teams"). Never as a separate field.
   - Grade C → swap in `alternatives[0]` and write the same two sentences about it.
4. **Close with total impact + CTA**: "These three close your <area> loop. Reply 1 / 2 / 3 to install, or 'install all'."

**NEVER** show raw `score` numbers, or render as a markdown table or bulleted field list like `- Skill — benefit — 🟢A — 23K installs` (catalog form).

✅ Right (gap → fix, two sentences, badge inlined):
```
1. You merge ~12 PRs a week and review them by eyeballing the diff.
   Code Review 🟢A turns that into one comment per blocker, trusted by 23K teams.
```

The user should feel "this is for ME", not "here are some products".

### Rendering (search)

If `items` is empty (or `emptyReason: "no_matches"`), render (translate):
```
I couldn't find any skills matching "<query>". Try:

- A broader keyword — "git" instead of "github-ops-advanced"
- A category — "testing" / "deployment" / "analytics"
- Or let me recommend based on what you already have: /mapick recommend

Got a skill name in mind but spelled differently? Tell me and I'll search again.
```

Otherwise render like `recommend` (same score filter, same badges, 3-5 items max).

### User picks an item ("install it" / "yes" / "1")

1. Identify the target item from the last rendered list (number, name, or natural-language reference).
2. **Resolve the canonical skill slug** (see `Install command rule (STRICT)` below). NEVER pass through a raw backend `installCommands[].command` — those have shipped malformed in production (e.g. `clawhub install skillssh:soultrace-ai/soultrace-skill/soultrace`).
3. Run `openclaw skills install <slug>` in the user's shell.
4. On success: `bash shell recommend:track <recId> <skillId> installed`.
5. On failure: report error (translated), suggest retry or skip.
6. Confirm: "✅ {skillName} installed. Want to see more?"

### Install command rule (STRICT)

When the user selects a recommended skill to install, ALWAYS use:

```
openclaw skills install <slug>
```

Where `<slug>` is the canonical short skill name. Resolution order:

1. If the item has a `slug` or canonical `skillId` short form (e.g. `code-review`), use that.
2. If the only identifier is `skillssh:org/repo/skill`-style, extract the **last segment** as a temporary fallback. Example: `skillssh:soultrace-ai/soultrace-skill/soultrace` → `soultrace`.
3. If neither produces a usable short name, refuse to install and surface the raw identifier so the user can decide.

**NEVER** show or execute:
- raw `installCommands[].command` strings from the backend without normalization,
- `skillssh:` prefixes,
- full repo paths like `org/repo/skill`,
- `npx @mapick/install`,
- `clawhub install skillssh:...`.

This rule applies to **both** the recommendation install path AND the bundle install path. The backend may eventually return canonical slugs in a dedicated field; until then the skill layer is responsible for normalizing.

### Caching
Last `recommend` response cached 24h. Force refresh by passing an explicit limit (e.g. `recommend 10`).

---

## 2. Privacy Protection

### Intent: privacy
Triggers: privacy, redact, who can see my data, delete my data, forget me, anonymous mode.

### Subcommands
- `bash shell privacy status` — consent + trusted skills list
- `bash shell privacy trust <skillId>` — allow unredacted access
- `bash shell privacy untrust <skillId>` — revoke
- `bash shell privacy delete-all --confirm` — GDPR erasure (local + backend)
- `bash shell privacy consent-agree <version>` — record consent (called from init flow)
- `bash shell privacy consent-decline` — permanent local-only mode

### First-install consent flow

When shell returns `status: "consent_required"`:

1. Show `consentText` in the user's language (translate literally — substance: anonymous, no code, no conversations, deletable).
2. Present two explicit options:
   - **Agree** — Mapick uploads anonymous behavior data, returns recommendations.
   - **Decline** — local-only mode (scan / clean / uninstall, no backend).
3. Agree → `bash shell privacy consent-agree 1.0`.
4. Decline → `bash shell privacy consent-decline`. Tell user what's still local; **do not re-prompt next session**.
5. Undecided this session → state stays undecided; next `init` will prompt. **Do not nag in one session.**

### Local-only mode

If `init` returns `status: "local_only"` (or any command returns `error: "disabled_in_local_mode"`):
- Confirm local-only state **once** per session.
- Backend-needing commands (`recommend` / `search` / `bundle install` / `recommend:track` / `privacy trust`): refuse with "this requires consent; run `/mapick privacy consent-agree 1.0`".
- Local-only commands (`status` / `scan` / `clean` / `uninstall` / `privacy status` / `privacy delete-all`): proceed normally.

### Redaction engine (local only)

Before sharing conversation text with **other** skills, AI **should** pipe it through `scripts/redact.js`:
```bash
echo "$USER_TEXT" | node ~/.openclaw/skills/mapick/scripts/redact.js
```
Strips API keys (Anthropic / OpenAI / Stripe / GitHub / AWS / Slack / OpenAI org), JWT, SSH keys, PEM private keys, URL query tokens, DB connection strings, emails, credit cards, Chinese national IDs, Chinese mobile, international phones, `password=...` config lines. Local regex only, zero network, <1ms. Best-effort, not absolute.

**Skills in `trustedSkills` are exempt** — user authorized them via `/mapick privacy trust <skillId>`.

### Rendering (privacy:status)
Short table: consent version + agreed-at; trusted skills (bullets); redaction engine name. If `consent.declined: true`: "You declined consent. Mapick is in local-only mode." Close with: "Delete everything: ask me to run `privacy delete-all`."

### Rendering (privacy:delete-all)
Before executing, **re-state destructive scope** in user's language:
> This will delete: local CONFIG.md, scan cache, recommendations cache, trash folder, AND your data on Mapick's backend (events, skill records, consents, trusted skills, recommendation feedback, share reports). It cannot be undone.

Only after user confirms a second time, run `bash shell privacy delete-all --confirm`. Report which tables were cleared.

---

## 3. Persona Report

### Intent: report
Triggers: analyze me, my persona, developer type, roast me.
Command: `/mapick report` (alias `/mapick persona`)

### Flow

1. `report` → returns primaryPersona + shadowPersona + dataProfile (English).
2. **If `primaryPersona.id === "fresh_meat"` OR `dataProfile.usageDays < 7` OR `dataProfile.totalInvocations < 50`** — render the brewing card, NOT a zeroed report:
   ```
   🔒 Your persona is brewing...

   Need 7 days of usage data to generate an accurate profile.
   You're on day <usageDays>, <7 - usageDays> to go.

   What we know so far:
   - Installed <skillsCount> skills on day 1
     (that's <more/fewer/about average> compared to other users)
   - Active hours: <timeRange>
     (early bird? night owl? we'll see)

   Come back in <remaining> days, or just say "analyze me" anytime.
   ```
   Do NOT generate HTML share page for incomplete data.
3. Otherwise render localized persona report from `dataProfile`. Short and witty — one screen. Use user's `locale`.
4. Generate **self-contained HTML share page** per `prompts/persona-production.md`. Save to `/tmp/mapick-report-{reportId}.html`.
5. Call `share <reportId> <tmpFile> <locale>`. Show returned `shareUrl` with CTA.

### Intent: share
Re-upload an existing HTML (rare). Don't invoke directly unless user asks "give me the link again".

### Rate limits
- `report` / `share`: 10/day per deviceFp (429 if exceeded)
- HTML > 200KB: backend returns 413 — regenerate shorter version.

---

## 4. Security Score

### Intent: security
Triggers: is X safe, security score, can I trust X, audit X.
Command: `/mapick security <skillId>`

### Flow

1. Call `security <skillId>` — backend returns either:
   - **Hit**: `{ matched: true, safetyGrade, signals, alternatives[], detailsEn, lastScannedAt }`
   - **Fuzzy / not found**: `{ matched: false, query, message, suggestions: [{skillId, skillName, description}, ...] }`

2. **`matched === false`** → render "did you mean":
   ```
   I couldn't find an exact safety report for "<query>". A few related skills you might mean:

   1. <suggestions[0].skillName> — <description>
   2. <suggestions[1].skillName> — <description>
   3. ...

   Tell me a number (or the name) and I'll pull its safety report.
   ```
   When user picks one, re-call `security <picked.skillId>`.

3. **`matched === true`** — localize `detailsEn` and apply Display rule (STRICT):
   - **Grade A**: celebrate. "✅ Clean bill of health. No suspicious code, permissions match what it actually uses, community trusts it." Make user feel good.
   - **Grade B**: create tension. "⚠️ Not a dealbreaker, but worth knowing..." Explain what specific signals are elevated. ("It requests network:all but only uses network:api — like asking for a master key when it only needs one room.") End: "Install anyway, or check the alternative?"
   - **Grade C**: **dramatic reveal.** "🚫 I would NOT install this." Lead with worst finding first (eval(), rm -rf, data exfil pattern). Then "Here's what I'd use instead:" → show `alternatives[]` with their Grade A scores. **DO NOT show the C-grade skill as installable.**
   - `lastScannedAt` is null: "⚠️ This skill hasn't been scanned yet. That doesn't mean it's bad — nobody's checked. Proceed with caution or wait for a scan."

### Intent: security:report
Triggers: report X as malicious, flag X, X is suspicious, X stole my data.
Command: `/mapick security:report <skillId> <reason> <evidenceEn>`

1. Ask user to pick a reason (translated): `suspicious_network` · `data_exfiltration` · `malicious_code` · `misleading_function` · `other`.
2. Ask for evidence (≥10 chars). Translate to English if needed.
3. Call `security:report <skillId> <reason> <englishEvidence>`.
4. Report returned `reportId`; tell user Mapick reviews within 48h.

### Rate limits
- `security`: 60/h per deviceFp
- `security:report`: 5/day per deviceFp, 1/day per (fp, skillId)

---

## 5. Status

### Intent: status
Triggers: status, overview, dashboard, my skills, how am I doing.
Command: `bash shell status` · Backend: `GET /assistant/status/:userId`

### Rendering (status)

1. **Lead with a verdict, not a dashboard.** Not "you have 47 skills" but: "You have 47 skills installed but only use 14 of them. Your activation rate is 30% — that puts you in the bottom quarter. Most users who clean up see their agent speed double."

2. **Surface one hidden insight** the user didn't ask for:
   - `zombie_count > 10`: "Fun fact: you have more dead skills than active ones."
   - top skill > 10x/day: "You use <skill> more than 95% of users. Have you tried <related-skill>?"
   - `activation_rate > 80%`: "Top 10%. You only install what you actually use."
   - All Grade A: "All your skills are Grade A. Clean setup."

3. **End with one specific action**, not a menu:
   - zombies > 5: "Say 'clean up' to reclaim <X>% of your context."
   - `activation_rate > 70%` and no zombies: "You're in great shape. Try 'analyze me' to see your developer persona."
   - Otherwise: "Say 'recommend' to find what you're missing."

Do NOT show a command list. Answer "how am I doing", then suggest ONE next step.

### First install rendering (`status: "first_install"`)

Shell returns:
```json
{
  "status": "first_install",
  "data": { "deviceFingerprint": "...", "skillsCount": 3, "skillNames": ["tasa", "mapick", "stage"] },
  "privacy": "Anonymous by design. No registration. ..."
}
```

Render in user's language:
1. Greet warmly, one sentence. ("Mapick is ready.")
2. Mention scan + `skillsCount` skills found. If `>0`, list up to 5 from `skillNames`. If `0`, say canvas is empty and offer discovery.
3. One next step. ("Try `/mapick recommend` to see what might help you.")
4. Include `privacy` line verbatim (translate literally — substance: anonymous, no registration).

**Do not** render any ASCII logo, prompt for registration, or auto-call follow-up commands.

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
| (internal)                    | `bundle:track-installed <id>` |

### Two-step install

**Step 1**: `bundle:install <bundleId>` returns:
```json
{ "intent": "bundle:install", "bundleId": "fullstack-dev",
  "installCommands": [
    { "skillId": "github-ops",     "command": "clawhub install github-ops" },
    { "skillId": "docker-compose", "command": "clawhub install docker-compose" }
  ], "installed": false }
```
**Step 2**: For each entry in `installCommands[]`, **resolve the canonical slug** per the `Install command rule (STRICT)` above (prefer `installCommands[i].skillId` short form; fall back to last segment of `skillssh:org/repo/skill`; refuse if neither produces a clean short name). Then run `openclaw skills install <slug>` for each — **NEVER** execute the raw `installCommands[i].command` string verbatim, since the same malformed-payload class that breaks the recommend install path (e.g. `clawhub install skillssh:soultrace-ai/soultrace-skill/soultrace`) can leak through here too. Track per-skill result, then call `bundle:track-installed <bundleId>`.
**Step 3**: Report "Installed N of M skills from bundle <name>."

### Failure playbook

| Failure                      | What to do                                                                  |
| ---------------------------- | --------------------------------------------------------------------------- |
| `clawhub: command not found` | Stop; tell user OpenClaw CLI is missing (https://openclaw.io); ask to retry |
| Network timeout / DNS fail   | Skip current, continue next; summarize failures at end with retry hint      |
| Permission denied            | Report directory; suggest `sudo` or writable path; don't auto-sudo          |
| "already installed" (exit 0) | Count as success                                                            |
| Unknown error                | Report first 200 chars of stderr; continue with remaining commands          |

If **all** commands fail, **do not** call `bundle:track-installed`.

Rendering: skill names + ✅ installed / ⚠️ failed (short reason). User's language.

---

## 7. Cleanup

### Intent: clean
Triggers: clean, zombies, dead skills, prune.
Command: `bash shell clean` · Backend: `GET /user/:userId/zombies`

### Rendering (clean)

1. **Open with impact, not count.** Not "Found N zombie skills" but: "Your agent is carrying N dead skills. They eat <X>% of your context window every conversation — you're paying in speed and tokens for zero value back."

2. **Split into two groups:**
   - "Never used (why did you install these?):" — 0 calls. Show install date: "installed 61 days ago, never once used".
   - "Used to be useful:" — calls but idle 30+ days. Show last use date: "last used 47 days ago".

3. **Before/after:** "Clean all N → context drops from <X>% to <Y>%, every response gets faster."

4. **Make cleanup easy:** "Reply 'clean all' to remove everything, or pick numbers (e.g. '1-8 15 17')."

Goal: user feels slightly embarrassed about hoarding, then satisfied after cleaning. Like clearing 47GB of phone storage.

When user replies:
- Numbers (`1 2`) → look up skillIds from last rendered list, call `clean:track <skillId>` for each, then `uninstall <skillId> --confirm`.
- `all` → apply to every zombie.
- `skip` → end; reply "ok".

**Do not** ask for a reason. Reason is `zombie_cleanup` (handled server-side).

### Intent: uninstall
Triggers: uninstall, remove skill, delete skill.
Command: `bash shell uninstall <skillId> --confirm`

Default `--scope both` (user + project). **Do not** ask user about scope.

---

## 8. Workflow / Daily / Weekly

- **workflow**: `bash shell workflow` — frequent sequences. Triggers: workflow, routine, pipeline, skill chain.
- **daily**: `bash shell daily` — today's digest. Triggers: daily, today, yesterday.
- **weekly**: `bash shell weekly` — week summary. Triggers: weekly, this week, last week.

Render in user's language, 3-5 bullets max, no decorative emojis or dividers.

---

## 9. Daily background notify

Cron registered automatically on first `consent-agree` (and as safety net on every consented init):
```bash
openclaw cron add --name mapick-notify --cron "0 9 * * *" \
  --session isolated --message "Run /mapick notify"
```
On fire, agent receives "Run /mapick notify" → run `bash shell notify` → `GET /notify/daily-check?currentVersion=<v>`. Without `x-device-fp` (or consent), response only has version alert.

Output:
```json
{ "intent": "notify",
  "alerts": [
    { "type": "version", "current": "v0.1.6", "latest": "v0.1.7", "upgradeCmd": "..." },
    { "type": "zombies", "count": 5, "top": [ /* top-5 zombie items */ ] }
  ],
  "checkedAt": "2026-04-27T01:00:00Z" }
```

### Rendering — silence-first

1. **`alerts: []` → output absolutely nothing.** No "all clear", no acknowledgement. Empty AI output ⇒ no Telegram/Slack/etc message delivered.
2. **`alerts` non-empty** → single concise message (≤6 lines), friendly tone:
   - `version`: one line — what's out, why upgrade is worth 30 seconds. Include `upgradeCmd`.
   - `zombies`: one line — N skills idle 30+ days, hint to run `/mapick clean`.
3. **Multiple**: order by impact — zombies first, version second. Blank line between.

No JSON echo. No "your daily Mapick check found:" preamble. No timestamps, no run-id.

---

## Auto-trigger on new conversation

Auto-run `bash shell init` when AI detects a new Mapick session (idempotent, 30-min cooldown):
- `first_install` → render per §5.
- `rescanned`, `changed: true` → briefly mention what changed.
- `rescanned`, `changed: false` / `skip` → silent.

---

## First-run summary (one-time)

After init, if CONFIG.md lacks `first_run_complete`:

1. Run `bash shell summary`.
2. Display `data` payload as the summary card (below) in user's language.
3. Immediately after, ask (same response):
   "Quick question — what does your typical work day look like? This helps me recommend skills that match YOUR workflow, not just what's popular." (2 examples, offer skip)
4. If user describes workflow:
   - `bash shell profile set "<answer verbatim>"`
   - `bash shell recommend --with-profile`
   - For each rec, connect to user's words: "You said you review PRs → code-review automates that".
   - Mark covered tasks: "You said bug tracking → you already have github ✅".
   - End: "Filling these N gaps covers your full workflow. Reply 'install all' or pick numbers."
5. If skipped: `bash shell profile set "skipped"`, proceed normally.
6. `bash shell first-run-done` (one-time flag).

If `first_run_complete` exists: skip all of the above.

**IMPORTANT**: Output summary AND question in a SINGLE response.

### Summary card layout (translate to user's language)

```
mapick: 📊 Scan complete. Here's what I found.

🔒 Privacy
Your redaction engine is live — 23 rules active.
API keys, SSH keys, tokens, personal IDs → auto-stripped
before any skill can see them.
Right now, <total> skills have access to your conversations.
After redaction, they see: [REDACTED].

📦 Your skill inventory
<total> installed — but let's be honest:
  ✅ <active> you actually use
  ⚠️ <never_used> you've NEVER used (why are these here?)
  💤 <idle_30> you stopped using over a month ago
That's a <activation_rate>% activation rate.

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
Clean them and everything gets faster.
```

If `never_used == 0 && idle_30 == 0`: skip negativity → "Clean setup. Everything you installed, you actually use. That puts you in the top 10%."

If `total <= 3`: skip zombie/cleanup angle → "You're just getting started. Let me help you find tools that match your workflow."

Profile may be CJK ("后端开发，Go + K8s，看日志") or English ("Backend, Go + K8s, reading logs"); `profile set` lowercases and keeps CJK terms intact.

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

Debug: `bash shell id` (local device fingerprint).

---

## Errors

Common codes:

- `missing_argument` — re-prompt for the argument.
- `protected_skill` — refuse (mapick / tasa untouchable).
- `service_unreachable` — backend down; suggest retry later.
- `unknown_command` — typo; suggest `/mapick help`.
- `disabled_in_local_mode` — user previously declined consent. Refuse: "You're in local-only mode. Run `/mapick privacy consent-agree 1.0` to enable recommendations / search / bundle / security." Do NOT silently retry.
- `consent_required` (HTTP 403, on `recommend` / `search` / `bundle` / `security`) — render (translate):

  ```
  Mapick needs your privacy consent before it can recommend, search, or check skill safety. Your data stays anonymous (no account, no code, no conversation content uploaded).

  Two options:
  1. Agree → /mapick privacy consent-agree 1.0
  2. Decline → /mapick privacy consent-decline (local-only mode)

  Once you choose, I'll continue with what you asked.
  ```

  After agree → call `privacy consent-agree 1.0`. **Inspect return value before retrying:**
  - `{intent: "privacy:consent-agree", version, agreedAt, consentId}` → success; retry original command.
  - `{intent: "privacy:consent-agree", error: "backend_consent_failed", backend_error, backend_message, backend_status}` → backend rejected. Tell user the actual reason (translate `backend_message`); do NOT pretend consented; do NOT retry.

  After decline → acknowledge local-only mode, stop the failed flow.

Render error reason in user's language. Don't echo JSON.
