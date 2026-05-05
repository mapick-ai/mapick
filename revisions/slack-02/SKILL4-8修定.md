---
name: mapickii
description: Mapickii — Skill recommendation & privacy protection for OpenClaw. Scans your local skills, suggests what you're missing, and keeps other skills from seeing your secrets.
metadata: { "openclaw": { "emoji": "🔍", "requires": { "bins": ["python3", "jq", "curl"] }, "primaryEnv": "MAPICKII_API_BASE" } }
---

# Mapickii

V1 principle: **Recommend to users, protect their privacy, let personas spread.**
Priority: recommendation = privacy > persona sharing > safety score > cleanup > everything else.

All command output below is **English reference** — AI must render in the user's
conversation language.

---

## 1. Recommendation & Discovery

**Why this is first**: Mapickii's core value is helping users find skills they
don't have but should. Everything else is secondary.

### Intent: recommend

Reference triggers (English): recommend, suggest, find skill, what should I
install, best skills, what am I missing, any suggestions, discover, skills for
me, good skills.

**Match in ANY language** — recognize equivalents in whatever language the user
speaks. Only treat this as the `recommend` intent when the user asks about
**skills / tools / what to install** (not general-purpose "recommend a book").

Shell command: `bash shell.sh recommend [limit]`
Backend: `GET /recommend/feed?limit=5` (DeviceFp guarded, 60/h rate limit)

### Intent: search

Reference triggers (English): search, find, look for, is there a skill for,
find a skill that, anything for X.

**Match in ANY language**.

Shell command: `bash shell.sh search <keyword> [limit]`
Backend: `GET /skill/live-search?query=&limit=10` (DeviceFp guarded, 30/min)

### Rendering (recommend)

When shell returns `{ intent: "recommend", items: [...] }`:

1. **Filter out items with `score < 0.4`** — they're too weak to surface.
2. **Open with a problem statement**, not a product catalog. Instead of "I found
   N skills", say what GAP the user has:
   "You have github but no review tool — your PRs are all manual."
   "You described log debugging but don't have a log analyzer."
   If no user profile exists, infer from installed skills.
3. **Show 3 items max**. For EACH item, you MUST:
   - **Connect it to the user**: reference something they said, do, or have installed.
     ("You use github 12x/day but don't have code-review")
     ("Matches your 'debug with logs' workflow")
   - **Say what it replaces**: what manual work goes away.
     ("Instead of scrolling 200 lines of logs, say 'find the error'")
   - **Show**: skill name + one-line benefit + safety badge (🟢A / 🟡B / 🔴C)
     + human-friendly install count ("23K installs")
   - If Grade C, show top `alternatives[]` entry instead.
4. **Close with total impact + call-to-action**:
   "Filling these 3 gaps covers your workflow end to end.
    Reply with numbers to install, or 'install all'."

**NEVER** show raw `score` numbers (3.614, 0.85) to the user.
**NEVER** just list skill names with stats — that's a catalog, not a recommendation.
The user should feel "this is for ME", not "here are some products".

### Rendering (search)

When shell returns `{ intent: "search", items: [...] }`:

**If `items` is empty** (empty array or `emptyReason: "no_matches"`), render
this template (translate to user's language):

```
I couldn't find any skills matching "<query>". Try:

- A broader keyword — "git" instead of "github-ops-advanced"
- A category — "testing" / "deployment" / "analytics"
- Or let me recommend based on what you already have: /mapickii recommend

Got a skill name in mind but spelled differently? Tell me and I'll search again.
```

**Otherwise** render like `recommend` above (same score filter, same confidence
phrases, same safety badges, 3-5 items max).

### User says "install it" / "yes" / "1"

After rendering a recommend/search result, wait for the user's reply. On reply:

1. Identify the target item from the last rendered list (by number, name, or
   natural-language reference).
2. From the item's `installCommands[]`, pick the entry where `platform` is
   `openclaw` and run that `command` in the user's shell.
3. On success, call `bash shell.sh recommend:track <recId> <skillId> installed`
   so the backend can tune future recommendations.
4. On failure, reply with the error (translated), and suggest retry or skip.
5. Confirm to user: "✅ {skillName} installed. Want to see more?"

### Caching

Shell caches the last `recommend` response for 24h via `_save_recommendations`.
If the user asks for recommendations again within 24h, shell serves the cached
list (no rate-limit burn). Force refresh: pass an explicit limit argument
(e.g. `recommend 10`) which goes through the full backend call.

---

## 2. Privacy Protection

**Why this is here**: Mapickii is open-source, anonymous by design, and does
not store personal data. With great recommendations comes privacy risk — this
chapter explains the protections.

### Intent: privacy

Reference triggers (English): privacy, redact, who can see my data, protect
my data, stop tracking, delete my data, forget me, erase my account,
anonymous mode.

**Match in ANY language**.

### Subcommands

- `bash shell.sh privacy status` — show current consent + trusted skills list
- `bash shell.sh privacy trust <skillId>` — allow skill to see unredacted content
- `bash shell.sh privacy untrust <skillId>` — revoke previous trust grant
- `bash shell.sh privacy delete-all --confirm` — GDPR erasure: wipe local + backend
- `bash shell.sh privacy consent-agree <version>` — record user consent (called from init flow)
- `bash shell.sh privacy consent-decline` — user declined → permanent local-only mode

### First-install consent flow

When shell returns `status: "consent_required"`:

1. Show `consentText` in the user's conversation language (translate literally —
   its substance matters: anonymous, no code, no conversations, deletable).
2. Present **two explicit options** to the user:
   - **Agree** — Mapickii uploads anonymous behavior data, returns recommendations.
   - **Decline** — Mapickii works in local-only mode (scan / clean / uninstall
     only, no recommendations, no backend calls).
3. If user agrees → call `bash shell.sh privacy consent-agree 1.0`.
4. If user declines → call `bash shell.sh privacy consent-decline`. Then tell
   the user what's still available locally and what's gone; **do not re-prompt
   consent on future runs**.
5. If user neither agrees nor declines in this session, state stays undecided;
   next `init` call will prompt again. Do **not** nag repeatedly in one session.

### Local-only mode behavior

If `bash shell.sh init` returns `status: "local_only"` (or any other command
returns `error: "disabled_in_local_mode"`):

- Confirm local-only state to the user **once** per session.
- For commands needing backend (`recommend` / `search` / `bundle install` /
  `recommend:track` / `privacy trust`): refuse with a message like "this
  requires consent; run `/mapickii privacy consent-agree 1.0` to opt in".
- For purely local commands (`status` / `scan` / `clean` / `uninstall` /
  `privacy status` / `privacy delete-all`): proceed as normal.

### Redaction engine (local only)

Before sharing any conversation text with **other** skills, AI **should** pipe
it through `scripts/redact.py`:

```bash
echo "$USER_TEXT" | python3 ~/.openclaw/skills/mapickii/scripts/redact.py
```

This strips API keys (Anthropic / OpenAI / Stripe / GitHub / AWS / Slack /
OpenAI org), JWT, SSH keys, PEM private keys, URL query tokens, DB connection
strings, emails, credit cards, Chinese national IDs, Chinese mobile numbers,
international phones, and `password=...` config lines via local regex.

Zero network calls, <1ms on typical input. Regex is "best effort" not absolute
— tell the user so if they ask.

**Skills in `trustedSkills` are exempt** — the user has explicitly authorized
them to see unredacted content via `/mapickii privacy trust <skillId>`.

### Rendering (privacy:status)

- Show a short table: consent version + agreed-at time; trusted skills list
  (bullets); redaction engine name.
- If `consent.declined: true`, call it out: "You declined consent. Mapickii is
  in local-only mode."
- Close with: "Delete everything: ask me to run `privacy delete-all`."

### Rendering (privacy:delete-all)

Before executing, **re-state the destructive scope** in the user's language:

> This will delete: local CONFIG.md, scan cache, recommendations cache, trash
> folder, AND your data on Mapickii's backend (events, skill records, consents,
> trusted skills, recommendation feedback, share reports). It cannot be undone.

Only after the user confirms a second time, execute
`bash shell.sh privacy delete-all --confirm`. On success, report which tables
were cleared (from the shell response).

---

## 3. Persona Report

### Intent: report

> Match in ANY language. Reference triggers (English): analyze me, my persona,
> my mapick report, who am I as a developer, developer type, roast me.
>
> Examples: "分析我" · "我的人格" · "analysiere mich" · "meine persönlichkeit" ·
> "私を分析して" · "분석해줘" · "analyze my developer type" · "generate my report"

Command: `/mapickii report`  (alias: `/mapickii persona`)

### Flow

1. Call `report` — returns primaryPersona + shadowPersona + dataProfile (English).
2. If `primaryPersona.id === "fresh_meat"` OR `dataProfile.usageDays < 7` OR
   `dataProfile.totalInvocations < 50`:

   **DO NOT show a full report with zeros. Instead render this:**

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

   **A card full of zeros creates nothing. A "brewing" card creates anticipation.**
   Do NOT generate HTML share page for incomplete data.

3. Otherwise (sufficient data), render a localized persona report to the user
   using `dataProfile`. Keep it short and witty — one screen. Use the user's
   `locale`.
4. Generate a **self-contained HTML share page** per the Production Prompt
   in [`prompts/persona-production.md`](prompts/persona-production.md).
   Save HTML to a temp file (e.g. `/tmp/mapickii-report-{reportId}.html`).
5. Call `share <reportId> <tmpFile> <locale>` to upload. Show the returned
   `shareUrl` to the user with a call-to-action (e.g., "Share on Twitter").

### Rate limits

- `report`: backend enforces 10/day per deviceFp → returns 429 if exceeded
- `share`:  backend enforces 10/day per deviceFp → returns 429 if exceeded
- HTML > 200KB → backend returns 413; ask AI to regenerate a shorter version.

### Intent: share

Re-upload an already-generated HTML (rare — user wants a fresh shareId or the
previous one expired). Skill command is `share <reportId> <htmlFile> [locale]`.
AI should not invoke this directly; only surface it if the user explicitly asks
"give me the link again" and the previous file is still available.

---

## 3.5. Security Score

### Intent: security

> Match in ANY language. Reference triggers (English): is X safe, security score
> of X, safety of X, can I trust X, scan X, X trustworthy, audit X.
>
> Examples: "X 安全吗" · "X 的安全评分" · "ist X sicher" · "Xは安全ですか" ·
> "can I install X" · "audit the github-ops skill"

Command: `/mapickii security <skillId>`

### Flow

1. Call `security <skillId>` — returns `safetyGrade` (A/B/C) + `signals` +
   `alternatives[]` + `detailsEn`.
2. Localize `detailsEn` into the user's locale.
3. **Display rule (STRICT)**:
   - Grade **A**: celebrate it. "✅ Clean bill of health. No suspicious code,
     permissions match what it actually uses, community trusts it." Make the
     user feel good about their choice.
   - Grade **B**: create tension. "⚠️ Not a dealbreaker, but worth knowing..."
     Then explain what specific signals are elevated — don't just say "caveats".
     Say "It requests network:all but only uses network:api — that's like asking
     for a master key when it only needs one room." End with: "Install anyway,
     or check the alternative?"
   - Grade **C**: **dramatic reveal.** "🚫 I would NOT install this." Lead with
     the worst finding first (eval(), rm -rf, data exfiltration pattern). Then:
     "Here's what I'd use instead:" → show `alternatives[]` with their Grade A
     scores. The user should feel like Mapick just saved them from something.
     **DO NOT show the C-grade skill as installable.**
   - If `lastScannedAt` is null: "⚠️ This skill hasn't been scanned yet.
     That doesn't mean it's bad — it means nobody's checked. Proceed with
     caution or wait for a scan."

### Intent: security:report

> Match in ANY language. Reference triggers: report X as malicious, flag X,
> X is suspicious, X stole my data, I want to report X.

Command: `/mapickii security:report <skillId> <reason> <evidenceEn>`

AI should:
1. Ask the user to pick a reason from this enum (translated):
   `suspicious_network` · `data_exfiltration` · `malicious_code` ·
   `misleading_function` · `other`
2. Ask for an evidence description (≥10 chars). Translate to English if needed.
3. Call `security:report <skillId> <reason> <englishEvidence>`.
4. Report back the returned `reportId` — tell the user Mapick security team
   reviews within 48 hours.

### Rate limits

- `security`: 60/hour per deviceFp
- `security:report`: 5/day per deviceFp, 1/day per (fp, skillId)

---

## 4. Status Overview

### Intent: status

Reference triggers (English): status, overview, dashboard, my skills, skill
stats, how am I doing, skill summary.

**Match in ANY language** — recognize equivalents in whatever language the
user speaks. The English words above are reference only, not an exhaustive
allow-list.

Shell command: `bash shell.sh status`
Backend: `GET /assistant/status/:userId` (FpOrApiKeyGuard, DeviceFp accepted)

### Rendering (status)

When shell returns `{ intent: "status", ... }`:

1. **Lead with a verdict, not a dashboard.** Not "you have 47 skills" but:
   "You have 47 skills installed but only use 14 of them. Your activation rate
    is 30% — that puts you in the bottom quarter. Most users who clean up see
    their agent speed double."

2. **Surface one hidden insight** the user didn't ask for:
   - If zombie_count > 10: "Fun fact: you have more dead skills than active ones."
   - If top skill usage > 10x/day: "You use <skill> more than 95% of users.
     Have you tried <related-skill>? It pairs well."
   - If activation_rate > 80%: "Your activation rate is <N>% — you're in the
     top 10%. You only install what you actually use."
   - If all skills are Grade A: "All your skills are Grade A. Clean setup."

3. **End with one specific action**, not a menu of options:
   - If zombies > 5: "Say 'clean up' to reclaim <X>% of your context."
   - If activation_rate > 70% and no zombies: "You're in great shape. Try
     'analyze me' to see your developer persona."
   - Otherwise: "Say 'recommend' to find what you're missing."

Do NOT show a command list. The user didn't ask "what can you do" — they asked
"how am I doing". Answer that question, then suggest ONE next step.

### First install rendering (`status: "first_install"`)

Shell returns a lean JSON:

```json
{
  "status": "first_install",
  "data": {
    "deviceFingerprint": "...",
    "skillsCount": 3,
    "skillNames": ["tasa", "mapick", "stage"]
  },
  "privacy": "Anonymous by design. No registration. ..."
}
```

**Render in the user's conversation language** (English reference below):

1. Greet warmly, in one sentence. Example: "Mapickii is ready."
2. Say it scanned the environment and found `skillsCount` skills. If
   `skillsCount > 0`, list up to 5 from `skillNames`. If `0`, say the canvas
   is empty and Mapickii can help discover skills.
3. Mention one next step. Example: "Ask me anything naturally, or try
   `/mapickii recommend` to see what might help you."
4. Include the one-line `privacy` note verbatim (translate literally — its
   substance matters: anonymous, no registration).

**Do not** render any ASCII logo, prompt for registration, or call a follow-up
command automatically.

---

## 5. Bundle Recommendations (M3)

Bundles solve the single-skill-recommend limit: users often need a cluster of
skills to complete a workflow.

### Intent: bundle

Reference triggers (English): bundle, bundle recommendation, recommend a
bundle, workflow pack, skill pack.

**Match in ANY language**.

| User input                      | Shell command                     | Notes                                  |
| ------------------------------- | --------------------------------- | -------------------------------------- |
| `/mapickii bundle`              | `bundle`                          | List bundles                           |
| `/mapickii bundle <id>`         | `bundle <id>`                     | Bundle detail                          |
| `/mapickii bundle recommend`    | `bundle:recommend`                | Recommend bundles based on installs    |
| `/mapickii bundle install <id>` | `bundle:install <id>`             | Fetch install commands (two-step flow) |
| (internal)                      | `bundle:track-installed <id>`     | AI calls after executing commands      |

### Bundle install — two-step flow (V1, by design)

**Step 1**: `bash shell.sh bundle:install <bundleId>` returns:

```json
{
  "intent": "bundle:install",
  "bundleId": "fullstack-dev",
  "installCommands": [
    { "skillId": "github-ops",     "command": "clawhub install github-ops" },
    { "skillId": "docker-compose", "command": "clawhub install docker-compose" }
  ],
  "installed": false
}
```

**Step 2**: AI executes each `installCommands[i].command` in the user's shell,
tracks per-command result, then calls `bash shell.sh bundle:track-installed <bundleId>`.

**Step 3**: Report summary to the user in their language: "Installed N of M
skills from bundle <name>."

### Failure handling (AI must follow this playbook)

| Failure                      | What to do                                                                                   |
| ---------------------------- | -------------------------------------------------------------------------------------------- |
| `clawhub: command not found` | Stop; tell user OpenClaw CLI is missing (https://openclaw.io); ask whether to retry          |
| Network timeout / DNS fail   | Skip current command, continue with next; summarize failures at end with retry hint          |
| Permission denied            | Report directory; suggest `sudo` or writable path; don't auto-sudo                           |
| "already installed" (exit 0) | Count as success                                                                             |
| Unknown error                | Report first 200 chars of stderr; continue with remaining commands                           |

If **all** commands fail and nothing installs, **do not** call
`bundle:track-installed`.

Rendering: use skill names + short per-item status (✅ installed / ⚠️ failed
with short reason). Render in the user's language.

---

## 6. Security Score

> V1 PR-12 delivered. See **§3.5 Security Score** above for full spec (Intent,
> flow, display rules, rate limits). This section kept as a cross-reference
> for readers skimming the table of contents.

---

## 7. Zombie Cleanup

### Intent: clean

Reference triggers (English): clean, cleanup, zombies, dead skills, unused,
prune, get rid of unused skills.

**Match in ANY language**.

Shell command: `bash shell.sh clean`
Backend: `GET /user/:userId/zombies` via `clean` case

### Rendering (clean)

When shell returns a zombie list:

1. **Open with impact, not count.** Not "Found N zombie skills" but:
   "Your agent is carrying N dead skills. They eat <X>% of your context
    window every single conversation — you're paying for them in speed
    and token cost but getting zero value back."

2. **Split zombies into two groups:**
   - "Never used (why did you install these?):" — skills with 0 total calls.
     Show install date to make it sting: "installed 61 days ago, never once used"
   - "Used to be useful:" — skills with calls but idle 30+ days.
     Show last use date: "last used 47 days ago"

3. **Show the before/after:**
   "Clean all N → context drops from <X>% to <Y>%, every response gets faster."

4. **Make cleanup dead simple:**
   "Reply 'clean all' to remove everything, or pick numbers (e.g. '1-8 15 17')
    to keep the ones you might still need."

The goal: user should feel slightly embarrassed about hoarding, then satisfied
after cleaning. Like clearing 47GB of phone storage.

When user replies:
- Numbers (e.g. `1 2`) → look up skillIds from the last rendered list, call
  `bash shell.sh clean:track <skillId>` for each, then `bash shell.sh uninstall <skillId> --confirm`.
- `all` → apply to every zombie.
- `skip` → end the flow; reply "ok".

**Do not** ask the user for a reason. Reason is always `zombie_cleanup`
(handled server-side).

### Intent: uninstall

Reference triggers (English): uninstall, remove skill, delete skill, drop it.

Shell command: `bash shell.sh uninstall <skillId> --confirm`

V1 default: `--scope` is `both` (user-level + project-level). Advanced users
can pass `--scope user` or `--scope project` to limit removal.

**Do not** ask the user which scope to use. The default covers the common case.

---

## 8. Workflow / Daily / Weekly

### Intent: workflow
Reference triggers (English): workflow, routine, pipeline, skill chain, common combos.
**Match in ANY language**.
Shell command: `bash shell.sh workflow`

### Intent: daily
Reference triggers (English): daily, today, yesterday, daily report, what's today.
**Match in ANY language**.
Shell command: `bash shell.sh daily`

### Intent: weekly
Reference triggers (English): weekly, this week, weekly summary, last week.
**Match in ANY language**.
Shell command: `bash shell.sh weekly`

### Rendering for these three

Each returns structured data (recent invocations, trends, top skills). Render
in the user's language, keep to 3-5 bullets max. No decorative emojis or
dividers.

---

## Lifecycle model (reference)

Install → First use → Active → Declining → Zombie → Uninstall

| Stage              | Trigger                          | Behavior                            |
| ------------------ | -------------------------------- | ----------------------------------- |
| Install            | Skill directory exists           | Record install time and path        |
| First use          | First invocation                 | Measure activation delay            |
| Activation timeout | No call within 7 days of install | Flag `activation_timeout`           |
| Active             | ≥ 2 calls in 7 days              | Compute frequency, detect sequences |
| Declining          | This week < 50% of last week     | Internal flag                       |
| Zombie             | No call in 30 days               | Flag `zombie`, surface in `clean`   |
| Uninstall          | User-triggered                   | Record reason, back up to `trash/`  |

---

## Auto-trigger (on every new conversation)

Shell auto-runs `bash shell.sh init` when AI detects a new Mapickii session.
Shell is idempotent: 30-minute cooldown prevents repeated full scans.

Responses:
- `status: "first_install"` → render per chapter 4.
- `status: "rescanned"`, `changed: true` → briefly mention what changed (added
  / removed skills).
- `status: "rescanned"`, `changed: false` or `status: "skip"` → silent.

---

## First-run summary (one-time only)

After init completes, check CONFIG.md for `first_run_complete`.

If `first_run_complete` does NOT exist:

1. Run: `bash shell.sh summary`
2. Display the `data` payload as a formatted report to the user
   (use the summary card layout below; translate to the user's language).
3. Immediately after the report, ask:
   "Quick question — what does your typical work day look like?
    This helps me recommend skills that match YOUR workflow,
    not just what's popular."
   Give 2 examples. Offer skip.
4. If user answers with a workflow description:
   - Run: `bash shell.sh profile set "<answer verbatim>"`
   - Run: `bash shell.sh recommend --with-profile`
   - DO NOT just list the results as a catalog.
   - For EACH recommended skill, connect it to what the user just said:
     "You said you review PRs → code-review automates that"
     "You said you read logs → log-analyzer lets you search instead of scroll"
   - Check which workflow tasks already have coverage (installed skill exists):
     "You said bug tracking → you already have github ✅"
   - End with total impact:
     "Filling these N gaps covers your full workflow.
      Reply 'install all' or pick numbers."
5. If user skips or asks something else:
   - Run: `bash shell.sh profile set "skipped"`
   - Proceed with their actual request normally.
6. Run: `bash shell.sh first-run-done` (marks the one-time flag so this
   summary never fires again for this user).

If `first_run_complete` already exists: skip all of the above, respond
normally.

**IMPORTANT**: Do NOT split the summary and the question into two messages.
Output the summary report AND the question in a single response.

### Summary card layout (render in the user's language)

**Make this feel like a system diagnostic, not a data dump.** The user just
installed Mapick — this is the first impression. It should feel like a doctor
running a scan and telling you "here's what I found."

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

If `never_used` is 0 and `idle_30` is 0: skip the negativity. Instead:
"Clean setup. Everything you installed, you actually use. That puts you
in the top 10% of OpenClaw users."

If `total` is ≤ 3: skip the zombie/cleanup angle. Instead focus on discovery:
"You're just getting started. Let me help you find tools that match
your workflow."

### Example recommendation output (after user answers)

```
mapick: Got it. Mapping your workflow to skills:

  ✅ Bug tracking → you already have github
  ❌ PR review → no review tool installed
  ❌ Log debugging → no log analyzer installed
  ❌ Cluster monitoring → no K8s dashboard

  🎯 3 skills to fill your gaps:

  1. code-review — automate PR reviews
     You said you review PRs — this replaces manual reviewing
     82% of github heavy users also install this          🟢 A

  2. log-analyzer — AI-powered log search
     You said you debug with logs — say "find the error"
     instead of scrolling 200 lines                       🟢 A

  3. k8s-dashboard — cluster monitoring
     You said you use K8s — real-time pod/node status      🟢 A

  Filling these 3 gaps covers your full workflow.
  Reply "install all" or pick numbers.
```

Match in ANY language — user may phrase workflow as "后端开发，Go + K8s，
看日志" or "Backend, Go + K8s, reading logs"; the profile-set subcommand
normalises to lowercase keywords and keeps CJK terms intact.

---

## Command reference

Primary commands (what to suggest to the user):

| Command                  | Purpose                                    |
| ------------------------ | ------------------------------------------ |
| `/mapickii`              | Status overview (alias for `status`)       |
| `/mapickii status`       | Detailed skill status                      |
| `/mapickii scan`         | Force re-scan                              |
| `/mapickii clean`        | List zombies, pick which to remove         |
| `/mapickii workflow`     | Frequent sequences                         |
| `/mapickii daily`        | Daily digest                               |
| `/mapickii weekly`       | Weekly summary                             |
| `/mapickii bundle`       | Browse bundles / install bundle            |
| `/mapickii profile clear`| Reset workflow profile + retrigger first-run summary |

PR-4 will add: `/mapickii recommend`, `/mapickii search <keyword>`.
PR-5 will add: `/mapickii privacy (status / delete-all / trust / consent-*)`.

Internal commands (invoked by AI, not typed by user):
- `bash shell.sh clean:track <skillId>` — record uninstall event
- `bash shell.sh bundle:track-installed <bundleId>` — record bundle install
- `bash shell.sh summary` — first-run scan summary (PR-16)
- `bash shell.sh profile set "<text>"` — store workflow profile + async upload (PR-16)
- `bash shell.sh profile get` — read cached workflow profile (PR-16)
- `bash shell.sh first-run-done` — mark one-time first-run summary complete (PR-16)
- `bash shell.sh recommend --with-profile` — feed with profileTags boost (PR-16)

Debug only:
- `bash shell.sh id` — show local device fingerprint

---

## Execution

Shell expects to run as a subprocess from within the AI conversation. All
responses are single-line JSON. AI should:

1. Parse the JSON (use `json.loads` / `JSON.parse`).
2. Render in the user's language using the chapter guidance above.
3. Never dump raw JSON to the user (except when the user explicitly asks for
   it in debug mode).

Errors: shell responds with `{ "error": "...", "message": "..." }`. AI should
paraphrase the error reason in the user's language, not show the JSON.

---

## CONFIG.md structure (auto-generated)

```yaml
device_fp: <16-hex>            # sha256(hostname|uname-s|uname-m|HOME)[:16]
created_at: <ISO8601>
last_init_at: <ISO8601>        # 30-min idempotency tracker
scan:                          # latest scan result
  scanned_at: <ISO8601>
  skills:
    - id: <skillId>
      name: <displayName>
      path: <absolute-path>
      installed_at: <ISO8601>
      enabled: <bool>
      last_modified: <ISO8601>
  system: { os, arch, hostname, home, editors: {...} }
recommendations:               # cached backend feed (PR-4)
  cached_at: <ISO8601>
  ttl_hours: 24
  items: [...]
first_run_complete: true       # one-time first-run flag (PR-16)
first_run_at: <ISO8601>
user_profile: <verbatim text>  # user workflow self-description (PR-16)
user_profile_tags: [...]       # extracted keywords, lowercase, deduped
user_profile_set_at: <ISO8601>
```

Do not write to CONFIG.md directly — always go through shell commands.

---

## Error handling

Common error codes from shell:

- `missing_argument` — user didn't supply a required argument; re-prompt
- `protected_skill` — tried to uninstall mapickii / mapick / tasa; refuse gracefully
- `service_unreachable` — backend down or network fail; suggest retry later
- `unknown_command` — typo or unsupported command; suggest `/mapickii help`

Render error reason in the user's language. Don't echo the JSON verbatim.
