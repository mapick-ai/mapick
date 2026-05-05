---
name: mapick
description: Mapick — Skill recommendation & privacy protection for OpenClaw. Scans your local skills, suggests what you're missing, and keeps other skills from seeing your sensitive data.
metadata: { "openclaw": { "emoji": "🔍", "requires": { "bins": ["node"], "node": ">=22.14" }, "permissions": { "network": ["api.mapick.ai","127.0.0.1:3010"], "file_read": ["~/.openclaw/skills/","~/.openclaw/workspace/skills/","~/.mapick/logs/","~/.mapick/cache/","/tmp/mapick-report-"], "file_write": ["~/.openclaw/skills/","~/.openclaw/workspace/skills/","~/.mapick/","/tmp/mapick-report-"] } } }
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
- **Use the literal command names registered in `scripts/shell.js` HANDLERS — do not abbreviate or invent shorthand.** Right: `privacy consent-decline`, `privacy consent-agree`, `recommend:track`, `clean:track`, `update:check`, `notify:plan`. Wrong: `privacy decline`, `privacy agree`, `recommend track`, `update check`. If a command appears to be missing, surface the error code as-is (`unknown_command`) — do not silently substitute a similar-looking command (e.g. don't fall through to `summary` because `status` "looked wrong").

Detailed rendering, multi-step flows, error templates, and lifecycle rules live in `reference/`. Load on demand.

---

## 1. Recommend / Search

### Intent: recommend
Triggers: recommend, suggest, find skill, what should I install, what am I missing.
Command: `node scripts/shell.js recommend [limit]` · cached 24h, force refresh with explicit limit.

### Intent: search
Triggers: search, find, look for, anything for X.
Command: `node scripts/shell.js search <keyword> [limit]`

### Intent: intent (P1 — local gap detection)
Triggers: user says they want to do something but don't have a skill for it ("I need to scrape data", "can I deploy to k8s", "有没有做代码审查的", "帮我读 PDF"). Also triggered by tool failures / missing capability in the current workflow.
Command: `node scripts/shell.js intent <natural language description>`

**How it works (privacy-first):**
1. You detect the gap from the user's natural language.
2. Call `intent "他们的原话"` — Mapick extracts keywords **locally**.
3. Only the extracted keywords are sent to the backend for search.
4. The user's full message never leaves the machine.

**Rendering:**
- When `items` non-empty: render like `search` results (same gap→fix two-sentence style, same badge rules).
- Lead with: "基于你说的「{original}」，我提取了关键词「{keywords}」帮你搜了一下" (translate to user's language).
- When `items` empty or `notice` present: surface the extracted keywords to the user so they can refine. Suggest trying `/mapick recommend` or broadening their description.
- NEVER show or transmit the raw `original` text — the `original` field in the response is for the AI's rendering context only.

On user pick: **resolve the canonical slug** (see Install command rule below) and run `openclaw skills install <slug>`, then `node scripts/shell.js recommend:track <recId> <skillId> installed`. NEVER pass through raw `installCommands[].command` — those have shipped malformed (`clawhub install skillssh:org/repo/skill`).

On user pick: **resolve the canonical slug** (see Install command rule below) and run `openclaw skills install <slug>`, then `node scripts/shell.js recommend:track <recId> <skillId> installed`. NEVER pass through raw `installCommands[].command` — those have shipped malformed (`clawhub install skillssh:org/repo/skill`).

### Install command rule (STRICT)

Always render: `openclaw skills install <slug>`. Slug resolution uses **resolveCanonicalSlug**:

**resolveCanonicalSlug(input) → slug:**
1. If input has `slug` field → use it directly.
2. If input has `skillId` with no path separators → use it (e.g. `code-review`).
3. If input has `skillssh:org/repo/skill` format → extract last segment (e.g. `skillssh:soultrace-ai/soultrace-skill/soultrace` → `soultrace`).
4. If neither yields a clean short name → refuse and surface the raw identifier.

**Applies to:**
- `/mapick recommend` → on user pick, resolve from `items[].skillId` or `items[].slug`.
- `/mapick bundle:install <id>` → resolve each entry in `installCommands[]` before running.

NEVER show or run: raw `installCommands[].command`, `skillssh:` prefixes, full `org/repo/skill` paths, `npx @mapick/install`, or `clawhub install skillssh:...`.

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

### Privacy model: function-level consent (P3)

Mapick defaults to **prompt-on-first-use**: the first time you run a command that needs the network (recommend, search, report, etc.), Mapick asks for consent. No data is sent until you choose one of three options:

- **允许并记住** (`always`) — allow all future network operations without prompting.
- **仅这一次** (`once`) — allow this one command; prompt again next time.
- **本地模式** (`declined`) — all remote commands disabled. Use local-only features.

Once a choice is made, it's stored in CONFIG.md. You can change it at any time:
- `node scripts/shell.js network-consent always`
- `node scripts/shell.js network-consent declined`

### Consent dialog (P3 — render exactly)

When shell returns `{ intent: "network_consent_required", ... }`, render this dialog in the user's language:

```
🔒 首次联网确认

Mapick 需要联网来推荐 skill。**不会发送**聊天内容、API key、文件内容。

仅发送：
• 匿名设备 ID
• 已安装 skill 名称列表
• 搜索关键词

选择：
1. 允许并记住 — 以后不再询问
2. 仅这一次 — 下次再问
3. 本地模式 — 只使用本地功能

回复 1、2 或 3。
```

On user pick:
- **1 → "允许并记住"**: run `node scripts/shell.js network-consent always`, then re-run the original command.
- **2 → "仅这一次"**: run `node scripts/shell.js network-consent once`, then re-run the original command. Consent expires after this command.
- **3 → "本地模式"**: run `node scripts/shell.js network-consent declined`. Do NOT re-run the original command. Show local alternatives instead.

### Subcommands
- `node scripts/shell.js privacy status` — current mode (default vs declined) + trusted skills list
- `node scripts/shell.js privacy trust <skillId>` — allow unredacted access
- `node scripts/shell.js privacy untrust <skillId>` — revoke
- `node scripts/shell.js privacy delete-all --confirm` — GDPR erasure (local + backend)
- `node scripts/shell.js privacy consent-decline` — opt out: refuse remote commands client-side
- `node scripts/shell.js privacy consent-agree` — undo a previous decline (only needed if you ran `consent-decline`)
- `node scripts/shell.js network-consent <always|once|declined>` — set function-level network consent
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

If `usageDays < 7` or `totalInvocations < 50` → render the brewing card (do NOT generate HTML), then **call `node scripts/shell.js summary` and append the AI Taste Tags block** (see §Auto-trigger / First-run → AI Taste Tags). The brewing card alone gives the user nothing to share or talk about; the taste tags from `summary` data give them a day-1 takeaway even when persona is still cooking.

If the `report` response contains `fallback: "local_day1_summary"` or `day1_summary` / `taste_tags`, render those tags immediately. This is the backend-rate-limit / backend-unavailable fallback path: do not stop at the error message, and do not generate HTML. Tell the user the full persona is still brewing, then show the local tags and summary.

Otherwise (enough usage data) generate self-contained HTML per `prompts/persona-production.md`, save only to `/tmp/mapick-report-{id}.html`, then `share <reportId> /tmp/mapick-report-{id}.html <locale>`. Never pass any other local file path to `share`.

Rate limits: report daily quota is temporarily disabled; share remains 10/day per fp. HTML > 200KB → 413, regenerate shorter.

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

**If the shell response has `welcome: true` → render the Welcome card below INSTEAD of normal status. Do NOT skip the welcome card, even if the user has sent status before.**

**Welcome card (P0 — mandatory, render exactly as specified):**

```
🎉 Mapick 已启动

我会帮你：
• 发现缺失的 skills（本地识别能力缺口，不上传聊天内容）
• 检查隐私设置和清理闲置 skills
• 需要联网时只发送：匿名设备 ID + skill 列表 + 搜索关键词

🎯 你的 AI 品味：「{taste_tags.tags[0]} + {taste_tags.tags[1]} + {taste_tags.tags[2]}」
{taste_tags.fact}
{taste_tags.cta}

你可以：
• 推荐我缺什么 → /mapick recommend
• 看隐私设置 → /mapick privacy status
• 关闭主动提醒 → /mapick update:settings off
```

**Normal status render (welcome already shown):**

Lead with a one-line verdict. Surface one hidden insight. Then ALWAYS render the taste_tags from the shell response:
```
🎯 你的 AI 品味：「{taste_tags.tags joined by ' + '}」
{taste_tags.fact}
{taste_tags.cta}
```

The shell response includes a `taste_tags` object. ALWAYS render it after the verdict:

```
🎯 你的 AI 品味：「{taste_tags.tags joined by ' + '}」
{taste_tags.fact}
{taste_tags.cta}
```

The verdict (1-2 sentences) + the 🎯 block together form a complete /mapick status response. Do NOT output only the verdict.

### First install (`welcome: true`)
The Welcome card above replaces the old first_install template. Do NOT use the old "first_install" template from rendering.md — always use the Welcome card when `welcome: true`.

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

Render `/mapick daily` as a day-1-friendly snapshot, not a dry digest:

1. Start with `📊 今日 Mapick 摘要`.
2. Summarize `data.yesterday` / `message` in 1-2 lines. If activity is low or zero, say the persona data is still light, then pivot to the local snapshot.
3. If `day1_summary` and `taste_tags` are present, render an `AI 使用快照` section and append the AI Taste Tags block (§Auto-trigger / First-run → AI Taste Tags). Use the returned `taste_tags` exactly; do not recalculate or invent a different tag. Do not call any extra API.
4. If `data.top2Recommendations` or `recommendations` are present, show exactly two recommendations under `💡 顺手补两个 Skill`, using the recommend rendering style: one sentence for the gap, one sentence for the fix. Do not show raw scores or JSON.
5. End with one specific CTA: install one recommendation, run `/mapick clean`, or run `/mapick report` depending on the strongest signal.

Weekly can stay compact: 3-5 bullets max.

---

## 9. Background notify

Background notify is checked by `/mapick notify`. Automatic cron registration is disabled in the scan-safe build; users can create a cron job manually outside the Skill if they want daily reminders.

On fire/manual run: `node scripts/shell.js notify` → `GET /notify/daily-check?currentVersion=<v>`.

Exact slash command routing: `/mapick notify` **always** runs `node scripts/shell.js notify`. Do not run `notify:plan` unless the user explicitly asks to set up, install, enable, or configure notifications/reminders.

Manual `/mapick notify`: render a small card even when `alerts: []`:

```
没有新通知 ✅

检查时间：<checkedAt localized>
版本更新：无
僵尸 Skill：无
其他警报：无

💡 顺手推荐两个 Skill
1. <skillName> — <why this helps>
2. <skillName> — <why this helps>
```

Use `recommendations` from the notify response. Show exactly two if available; if none are available, skip the recommendation section. Keep it short and do not show raw JSON, score, ids, or install commands unless the user asks to install.

Background cron phrasing exactly like `Run /mapick notify`: keep **silence-first** for `alerts: []` to avoid pushing empty daily messages.

`alerts` non-empty → ≤6 lines, friendly tone, version first then zombies.

Templates: `reference/rendering.md#notify-silence-first`.

---

## 10. Updates & Notify Setup

### Intent: check / set up reminders / upgrade
Triggers: any update?, what's outdated, check updates, set up daily reminders, notify me when updates, 帮我装 notify, 升级 mapick, 把可升级的都升级, 关闭更新提醒.

Mapick **detects** but **never** auto-installs/auto-upgrades. All install / upgrade / cron-setup actions return a `*:plan` JSON for the AI to render and ask the user "确认 / cancel?" before running. The AI runs the actual command via its bash tool — Mapick itself has zero subprocess execution.

### Detect

Command: `node scripts/shell.js update:check`

Returns `{intent: "update:check", items: [...]}`. Each item is one update opportunity:
- `mapick_self` — Mapick has a newer version
- `skill` — an installed Skill has a newer version (requires `/skills/check-updates` backend; fails silently if unavailable)
- `notify_missing` — daily-notify cron not running (heuristic: `last_notify_at` empty or > 7 days old)

`settings.update_mode: "off"` returns empty items + an explainer message. Same when `consent_declined`.

`dev_build: true` on the response means the running tree is a local / unreleased build (`local-<sha>-<ts>` etc.). Mapick suppresses `mapick_self` items in that case — say "Running a local dev build (`<installed_version>`); release-channel updates don't apply" and only render any remaining items (`skill` / `notify_missing`).

### Render `update:check`

If `items: []` and no `message`: reply "Everything's up to date." If `items: []` with `message`: render the message verbatim. Otherwise:

```
Found <N> things:

- Mapick v0.0.15 → v0.0.17. "upgrade mapick"
- github-ops v1.2.0 → v1.3.0. "upgrade github-ops"
- Daily reminders not set up. "set up daily reminders"

Reply with what you want, or "skip" / "暂时不要".
```

NEVER show raw JSON. NEVER auto-execute.

### Natural-language authorization

Match user reply to `items[].next.trigger_phrases` OR semantic equivalent (any language). On match, run the item's `next.command` (which returns a `*:plan`).

| User says | Run |
| --- | --- |
| "upgrade mapick" / "升级 mapick" | `node scripts/shell.js upgrade:plan mapick` |
| "upgrade <skillId>" | `node scripts/shell.js upgrade:plan <skillId>` |
| "set up daily reminders" / "开通知" | `node scripts/shell.js notify:plan` |
| "install all" / "全装" | run each item's `next.command` in turn |
| "skip" / "暂时不要" | run `node scripts/shell.js update:dismissed <id>` for each item, reply "ok" |

For `upgrade:plan <id>` to work, `<id>` should be `mapick` or any installed Skill ID.

### Render `*:plan`

When shell returns `{intent: "*:plan", commands, what_it_does, what_it_doesnt, stops}`:

Each entry in `commands[]` has a `kind` field (default `"command"` if absent):
- `kind: "command"` — render the literal `command` string in the plan box.
- `kind: "instruction"` — render the `instruction` text as a paraphrase prefixed with "AI step:".

```
I'll run:

  $ <commands[0].command>           ← if kind: "command"
  AI step: <commands[1].instruction>  ← if kind: "instruction"
  $ <commands[2].command>

What it does: <what_it_does>
What it doesn't: <what_it_doesnt>
To stop later: <stops>

Confirm? Reply "确认" / "yes" to proceed, or "取消" to abort.
```

NEVER auto-confirm. NEVER omit the `what_it_doesnt` line.

### After user confirms

1. For each step in `commands`:
   - `kind: "command"` AND `executes_in_mapick: true` → run via `node scripts/shell.js <subcommand>`.
   - `kind: "command"` (default) → run the literal `command` via your bash tool.
   - `kind: "instruction"` → execute the multi-step instruction in `instruction` text. Typically this means: run a list/inspect command, parse its output, then run zero-or-more derived commands. Capture each derived command's outcome.
   - Capture exit code + last 200 chars of stderr per command.
2. On any failure: stop. If `after_failure_rollback`, run it. Tell user the exact failure (translate stderr).
3. On full success: run `after_success_track`.
4. **For `notify:plan` only — verify delivery route before claiming success.** After step 3, run `openclaw cron list --json`, find the `mapick-notify` entry, then run `openclaw chat list --json` (or the equivalent on the active OpenClaw runtime) to confirm at least one chat route is registered. If no route exists, the cron will fire but fail-close — surface this to the user explicitly:

   > ⚠️ Cron is scheduled, but no chat delivery route is configured. Set up a route with `openclaw chat add ...` or notifications will silently drop.

   Do NOT report a clean "all set" without this check passing. Otherwise, reply with one-line confirmation.

5. **Delivery route verification (post-install check):** For `notify:plan` success path, explicitly guide the user when delivery is not set up:
   - Run `openclaw chat list --json` after cron registration
   - If `channels` array is empty or missing, show:
     ```
     ⚠️ 通知渠道未配置
     
     定时任务已创建，但没有投递目标。请选择：
     
     1. 添加 Telegram 频道 → `openclaw chat add --telegram <chat_id>`
     2. 添加 Slack 频道 → `openclaw chat add --slack <channel_id>`
     3. 暂时跳过 → 稍后运行 `/mapick notify:plan` 重新设置
     
     没有投递渠道，通知将无法送达。
     ```
   - If `channels` array has entries, show success with channel name: "✅ 每日提醒已启用，将投递到: {channel_name}"

### Settings

- `node scripts/shell.js update:settings off` — disable detection entirely.
- `node scripts/shell.js update:settings on` — default. Detect + tell user when there are items.
- `node scripts/shell.js notify:status` — show last notify activity + dismissal expiry.

Dismissal:
- `update:dismissed notify_setup` — silent on cron-setup prompt for **14 days**.
- `update:dismissed <skillId> [version]` — silent on that skill upgrade for **7 days**.

Mapick **does not install, upgrade, remove, or modify other Skills unless you explicitly confirm the action.** All install/upgrade actions show a plan before execution; rollback is supported via `backup:restore`.

---

## 11. Radar（机会雷达）(P2)

Daily low-frequency skill gap radar. Runs silently — only speaks when it finds something.

### Intent: radar
Triggers: `/mapick radar`, triggered once per day by the AI after init.
Command: `node scripts/shell.js radar`

Returns either:
- `{ silent: true, reason: "..." }` — absolutely nothing to do. Do not render, do not acknowledge.
- `{ silent: false, gaps: [...] }` — up to 2 skill gaps with categories.

### Frequency control (automatic)
- Max 1 run per day (`last_radar_at` cooldown).
- Same category silent for 7 days.
- User rejects a category 2 times → category muted for 14 days.

### Rendering: radar (non-silent)

Lead with a single sentence that connects to something the user actually does:
> 今天发现一个能力缺口：你最近在处理 X/Twitter 数据，但当前只有 xurl，没有通用跨平台抓取。

Then for each gap (max 2), render two sentences like recommend:
1. The gap — what you're doing without the right tool.
2. The fix — skill name + safety badge + what manual work disappears.

End with a single CTA:
> 回复 1 或 2 安装，或 "skip" 暂时不要。

### Tracking rejections

When user says "skip" / "暂时不要" / "no" to a specific radar gap, call:
```
node scripts/shell.js radar:reject <category>
```

This increments the rejection counter for that category so the radar won't nag.

---

## Auto-trigger / First-run

On new Mapick session, run `node scripts/shell.js init` (idempotent, 30-min cooldown). Detail: `reference/lifecycle.md#auto-trigger-on-new-conversation`.

**Three scenarios that MUST show taste tags:**

1. **First install** — `init` returns `status: "first_install"`: render per §Intent: status → First install template (includes 🎯 tags as centerpiece).
2. **Daily / periodic** — `init` returns normal status data: render a compact status line, then **always append 🎯 tags**. Make this feel like a daily fortune cookie.
3. **Post-upgrade** — if `init` runs after a version bump: same as scenario 2, but add "Mapick 已升级到 v<version>" before the tags.

If CONFIG.md lacks `first_run_complete`: run `node scripts/shell.js summary`, render the summary card WITH taste tags, ask one workflow question, then on answer call `profile set` + `recommend --with-profile` + `first-run-done`. Output summary AND question in a SINGLE response.

**IMPORTANT: Taste tags are MANDATORY in every init/status/summary/first-run render.** Never show just a number dump — the 🎯 line is the only thing users share. Without it, there is zero virality.

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
   Audit: /mapick privacy log    Decline: /mapick privacy consent-decline

---
🎯 你的 AI 品味：「{quantity_tag} + {efficiency_tag} + {stack_tag}」
{brag_line}
📤 测测你朋友的 → /mapick status
```

After rendering the summary card, you MUST generate the AI Taste Tags block (the 🎯 section above). Use the lookup tables under §AI Taste Tags (below) with the `total`, `active`, `never_used`, `top_used` values from the summary data. This block is MANDATORY — never skip it after a summary card, even when total <= 3 or never_used == 0. Only skip when `total == 0`.

If `never_used == 0 && idle_30 == 0`: skip negativity → "Clean setup. Top 10%." If `total <= 3`: skip the zombie angle → "Just getting started — let me find tools that match your workflow." If `has_backend: false`: skip the heavy-hitters + safety-check sections; say "Backend offline; counts only."

**After ANY summary card render (regardless of branch taken above), you MUST always append the AI Taste Tags block.** The tags section uses the same `total`, `active`, `never_used`, `top_used` fields from the summary data. Never omit it — the tags are the shareable takeaway. Only skip when `total == 0`.

### AI Taste Tags (generate from summary data, no extra API call)

Generate **2–3 taste tags** from the data already returned by `summary` (`total`, `active`, `never_used`, `idle_30`, `top_used`). These tags are a lightweight day-1 artifact — they replace nothing, they augment.

If a command response already includes `taste_tags` and `taste_fact`, render those values exactly and skip recomputing the lookup locally. This prevents arithmetic drift in the model response.

Two contexts to apply:

1. **First-run summary card** — append after the summary card.
2. **`/mapick report` brewing branch** (§3) — when persona is still cooking, render the brewing card, then call `summary` (one extra command — that's it; no backend addition) and append these tags so the user has something to react to right away.

Skip the entire taste-tags block when `total == 0` (a fresh install with no skills installed yet — no signal to riff on).

Lookup tables:

**Quantity** (from `total`):
- `total >= 40` → `收藏癖 Collector`
- `total 15–39` → `实用主义 Pragmatist`
- `total 5–14` → `极简主义 Minimalist`
- `total < 5` → `刚起步 Newbie`

**Efficiency** (from `active / total`):
- `< 30%` → `囤货不用型 Hoarder`
- `30–60%` → `还在探索 Explorer`
- `60–90%` → `效率选手 Optimizer`
- `> 90%` → `断舍离大师 Marie Kondo`

**Stack** (from `top_used[].name`):
- contains `github` / `docker` / `k8s` → `硬核极客 Hardcore Geek`
- contains `summarize` / `writing` / `content` → `内容创作者 Creator`
- contains `data-analysis` / `visualization` → `数据控 Data Nerd`
- contains `productivity` / `calendar` / `email` → `效率狂人 Productivity Freak`
- mixed / unrecognizable → `杂食动物 Omnivore`

**Bonus** (only if `never_used > 5`):
- `装了不用协会会长 Install-and-Forget Champion`

Pick the **3 most interesting** (most differentiating). Rendering format:

```
🎯 你的 AI 品味：「{tag1} + {tag2} + {tag3}」
```

Then one 冷知识 line comparing to other users using `total`:
- `total > 40` → `你装的 Skill 数量超过 82% 的用户`
- `total > 20` → `…超过 60% 的用户`
- `total > 10` → `…超过 40% 的用户`
- otherwise: skip the 冷知识 line

End with the share CTA:

```
📤 测测你朋友的 → /mapick status
```

(The `s.mapick.ai` share link will land in V2; today the CTA bounces a friend through the same first-run flow.)

Full 6-step flow: `reference/flows.md#first-run-summary`.

---

## Command reference

User-facing:

| Command                  | Purpose                                              | Trigger phrases (any language) |
| ------------------------ | ---------------------------------------------------- | ------------------------------ |
| `/mapick`                | Status overview (alias for `status`)                 | status, overview, dashboard, my skills |
| `/mapick status`         | Detailed skill status                                | how am I doing, 技能状态 |
| `/mapick scan`           | Force re-scan                                        | rescan, refresh skills |
| `/mapick clean`          | List zombies, pick which to remove                   | zombies, dead skills, 清理 |
| `/mapick recommend`      | Recommendations                                      | suggest skills, 缺什么, what should I install |
| `/mapick search <kw>`    | Search skills                                        | find skill, 搜一下 |
| `/mapick intent <desc>`  | Natural language → local keywords → search           | I need X, 有没有 Y 的工具, 帮我找 |
| `/mapick bundle`         | Browse / install bundles                             | workflow pack, skill pack, 技能包 |
| `/mapick security <id>`  | Safety check                                         | is X safe, security score, trust, 安全吗 |
| `/mapick report`         | Persona report                                       | analyze me, my persona, developer type |
| `/mapick privacy <sub>`  | status / trust / untrust / delete-all / consent-*    | privacy, 隐私, 数据保护 |
| `/mapick workflow`       | Frequent sequences                                   | routine, pipeline, skill chain |
| `/mapick daily`          | Daily digest                                         | today, yesterday, 今日摘要 |
| `/mapick weekly`         | Weekly summary                                       | this week, last week, 周报 |
| `/mapick stats`          | Global & personal stats (installs, conversions)      | statistics, 数据统计 |
| `/mapick stats --detail` | Detailed personal stats + accuracy trend             | my stats, 个人统计, 详细统计 |
| `/mapick stats user`     | Alias for stats --detail                             | 个人数据 |
| `/mapick radar`          | Daily gap radar (silent when nothing to report)      | radar, 雷达, 机会 |
| `/mapick profile clear`  | Reset workflow profile + retrigger first-run summary | reset profile, 重置配置 |
| `/mapick diagnose`       | Show loaded version/path and workspace shadow risks  | version, loaded path, 诊断, 版本信息 |
| `/mapick install`        | Run install.sh (Phase 1 setup)                      | install mapick, 安装 mapick, set up mapick, 配置 mapick |
| `/mapick diagnose --install-check` | Verify installation status                 | is mapick installed, 检查安装, verify setup |

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
