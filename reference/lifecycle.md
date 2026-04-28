# Skill Lifecycle Model

```
Install → First use → Active → Declining → Zombie → Uninstall
```

| Stage | Trigger | Behavior |
|-------|---------|----------|
| Install | Skill directory exists | Record install time |
| First use | First invocation | Measure activation delay |
| Active | ≥2 calls in 7 days | Compute frequency |
| Declining | This week < 50% of last | Internal flag |
| Zombie | No call in 30 days | Surface in `clean` |
| Uninstall | User-triggered | Backup to `trash/` |

Activation rate = `active_skills / total_installed` (report as %)

## First-install consent flow

When shell returns `status: "consent_required"`:

1. Show `consentText` in the user's language (translate literally — substance: anonymous, no code, no conversations, deletable).
2. Present two explicit options:
   - **Agree** — Mapick uploads anonymous behavior data, returns recommendations.
   - **Decline** — local-only mode (scan / clean / uninstall, no backend).
3. Agree → `bash shell privacy consent-agree 1.0`.
4. Decline → `bash shell privacy consent-decline`. Tell user what's still local; **do not re-prompt next session**.
5. Undecided this session → state stays undecided; next `init` will prompt. **Do not nag in one session.**

## Local-only mode

If `init` returns `status: "local_only"` (or any command returns `error: "disabled_in_local_mode"`):
- Confirm local-only state **once** per session.
- Backend-needing commands (`recommend` / `search` / `bundle install` / `recommend:track` / `privacy trust`): refuse with "this requires consent; run `/mapick privacy consent-agree 1.0`".
- Local-only commands (`status` / `scan` / `clean` / `uninstall` / `privacy status` / `privacy delete-all`): proceed normally.

## Auto-trigger on new conversation

Auto-run `bash shell init` when AI detects a new Mapick session (idempotent, 30-min cooldown):
- `first_install` → render per `reference/rendering.md#first_install`.
- `rescanned`, `changed: true` → briefly mention what changed.
- `rescanned`, `changed: false` / `skip` → silent.