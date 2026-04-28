# Multi-step Flows

## Persona report

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

## Security score

1. Call `security <skillId>` — backend returns either:
   - **Hit**: `{ matched: true, safetyGrade, signals, alternatives[], detailsEn, lastScannedAt }`
   - **Fuzzy / not found**: `{ matched: false, query, message, suggestions: [{skillId, skillName, description}, ...] }`

2. **`matched === false`** → render "did you mean" template. See `reference/rendering.md#security`.

3. **`matched === true`** — localize `detailsEn` and apply Grade A/B/C display rule. See `reference/rendering.md#security`.

## security:report

1. Ask user to pick a reason (translated): `suspicious_network` · `data_exfiltration` · `malicious_code` · `misleading_function` · `other`.
2. Ask for evidence (≥10 chars). Translate to English if needed.
3. Call `security:report <skillId> <reason> <englishEvidence>`.
4. Report returned `reportId`; tell user Mapick reviews within 48h.

## Bundle two-step install

**Step 1**: `bundle:install <bundleId>` returns:
```json
{ "intent": "bundle:install", "bundleId": "fullstack-dev",
  "installCommands": [
    { "skillId": "github-ops",     "command": "clawhub install github-ops" },
    { "skillId": "docker-compose", "command": "clawhub install docker-compose" }
  ], "installed": false }
```

**Step 2**: Execute each `installCommands[i].command`, track per-command result, then call `bundle:track-installed <bundleId>`.

**Step 3**: Report "Installed N of M skills from bundle <name>."

If **all** commands fail, **do not** call `bundle:track-installed`.

Rendering: skill names + ✅ installed / ⚠️ failed (short reason). User's language.

### Failure playbook

| Failure                      | What to do                                                                  |
| ---------------------------- | --------------------------------------------------------------------------- |
| `clawhub: command not found` | Stop; tell user OpenClaw CLI is missing (https://openclaw.io); ask to retry |
| Network timeout / DNS fail   | Skip current, continue next; summarize failures at end with retry hint      |
| Permission denied            | Report directory; suggest `sudo` or writable path; don't auto-sudo          |
| "already installed" (exit 0) | Count as success                                                            |
| Unknown error                | Report first 200 chars of stderr; continue with remaining commands          |

## First-run summary

After init, if CONFIG.md lacks `first_run_complete`:

1. Run `bash shell summary`.
2. Display `data` payload as the summary card (see `reference/rendering.md#summary-card`) in user's language.
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
