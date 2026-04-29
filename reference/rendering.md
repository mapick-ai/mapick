# Rendering Rules

Detailed rendering templates for each Mapick command. Load when SKILL.md
section needs more detail.

## recommend

When shell returns `{ intent: "recommend", items: [...] }`:

1. **Filter `score < 0.4`** — too weak to surface.
2. **Open with a problem statement**, not a catalog. Say what GAP the user has, not "I found N skills":
   "You have github but no review tool — your PRs are all manual."
   If no profile exists, infer from installed skills.
3. **Show 3 items max.** For each, render exactly TWO sentences — no tables, no bulleted field lists:
   - **Sentence 1 — the gap**: one concrete thing the user does manually today. Reference something they said, installed, or do. ("You merge ~12 PRs a week and review them by eyeballing the diff.")
   - **Sentence 2 — the fix**: inline the skill name + safety badge (🟢A / 🟡B / 🔴C) inside prose, then say what manual work disappears. ("Code Review 🟢A turns that into one comment per blocker.")
   - Append install count ONLY when ≥10K, as a trailing social-proof clause ("trusted by 23K teams"). Never as a separate field.
   - Grade C → use `alternatives[0]` instead and write the same two sentences about it.
4. **Close with total impact + CTA**: "These three close your <area> loop. Reply 1 / 2 / 3 to install, or 'install all'."

**NEVER** show raw `score` numbers, or render as a markdown table or bulleted field list like `- Skill — benefit — 🟢A — 23K installs` (catalog form).

✅ Right (gap → fix, two sentences, badge inlined):
```
1. You merge ~12 PRs a week and review them by eyeballing the diff.
   Code Review 🟢A turns that into one comment per blocker, trusted by 23K teams.
```

The user should feel "this is for ME", not "here are some products".

## search

If `items` is empty (or `emptyReason: "no_matches"`), render (translate):
```
I couldn't find any skills matching "<query>". Try:

- A broader keyword — "git" instead of "github-ops-advanced"
- A category — "testing" / "deployment" / "analytics"
- Or let me recommend based on what you already have: /mapick recommend

Got a skill name in mind but spelled differently? Tell me and I'll search again.
```

Otherwise render like `recommend` (same score filter, same badges, 3-5 items max).

## privacy:status

Short table: mode + remote access + consent version/agreed-at + trusted skills
(bullets) + redaction engine name.

- If `mode: "default_on"` / `remote_access: "enabled"`: say Mapick is using the default anonymous sharing mode; no account, code, chat content, API tokens, or credentials are uploaded. Mention `/mapick privacy log` and `/mapick privacy consent-decline`.
- If `consent.declined: true`: "You declined data sharing. Mapick is in local-only mode." Close with: "Resume: `/mapick privacy consent-agree`."
- Always close destructive deletion separately: "Delete everything: ask me to run `privacy delete-all`."

## privacy:delete-all

Before executing, **re-state destructive scope** in user's language:

> This will delete: local CONFIG.md, scan cache, recommendations cache, trash folder, AND your data on Mapick's backend (events, skill records, consents, trusted skills, recommendation feedback, share reports). It cannot be undone.

Only after user confirms a second time, run `bash shell privacy delete-all --confirm`. Report which tables were cleared.

## security

When `matched === false`:
```
I couldn't find an exact safety report for "<query>". A few related skills you might mean:

1. <suggestions[0].skillName> — <description>
2. <suggestions[1].skillName> — <description>
3. ...

Tell me a number (or the name) and I'll pull its safety report.
```
When user picks one, re-call `security <picked.skillId>`.

When `matched === true`, localize `detailsEn` and apply Display rule (STRICT):

- **Grade A**: celebrate. "✅ Clean bill of health. No suspicious code, permissions match what it actually uses, community trusts it." Make user feel good.
- **Grade B**: create tension. "⚠️ Not a dealbreaker, but worth knowing..." Explain what specific signals are elevated. ("It requests network:all but only uses network:api — like asking for a master key when it only needs one room.") End: "Install anyway, or check the alternative?"
- **Grade C**: **dramatic reveal.** "🚫 I would NOT install this." Lead with worst finding first (eval(), rm -rf, data exfil pattern). Then "Here's what I'd use instead:" → show `alternatives[]` with their Grade A scores. **DO NOT show the C-grade skill as installable.**
- `lastScannedAt` is null: "⚠️ This skill hasn't been scanned yet. That doesn't mean it's bad — nobody's checked. Proceed with caution or wait for a scan."

## status

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

## first_install

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

## clean

1. **Open with impact, not count.** Not "Found N zombie skills" but: "Your agent is carrying N dead skills. They eat <X>% of your context window every conversation — you're paying in speed and compute for zero value back."

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

## notify (silence-first)

1. **`alerts: []` → output absolutely nothing.** No "all clear", no acknowledgement. Empty AI output ⇒ no Telegram/Slack/etc message delivered.
2. **`alerts` non-empty** → single concise message (≤6 lines), friendly tone:
   - `version`: one line — what's out, why upgrade is worth 30 seconds. Include `upgradeCmd`.
   - `zombies`: one line — N skills idle 30+ days, hint to run `/mapick clean`.
3. **Multiple**: order by impact — zombies first, version second. Blank line between.

No JSON echo. No "your daily Mapick check found:" preamble. No timestamps, no run-id.

## summary card

```
mapick: 📊 Scan complete. Here's what I found.

🔒 Privacy
Your redaction engine is live — 23 rules active.
Provider access strings, certificates, and personal IDs → auto-stripped
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

🔒 Outbound: anonymous device id + skill IDs you act on + timestamps.
   Audit: /mapick privacy log    Decline: /mapick privacy decline
```

If `never_used == 0 && idle_30 == 0`: skip negativity → "Clean setup. Everything you installed, you actually use. That puts you in the top 10%."

If `total <= 3`: skip zombie/cleanup angle → "You're just getting started. Let me help you find tools that match your workflow."

Profile may be CJK ("后端开发，Go + K8s，看日志") or English ("Backend, Go + K8s, reading logs"); `profile set` lowercases and keeps CJK terms intact.
