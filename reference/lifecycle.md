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

## Privacy model: opt-out

Mapick defaults to data-sharing **on** for new installs. There is no agreement gate. `recommend` / `search` / `bundle` / `security` all work the moment a user installs.

The first-install summary card includes a one-line disclosure with the actual outbound contract + how to opt out (`/mapick privacy log` to audit, `/mapick privacy consent-decline` to opt out).

## Decline / re-enable flow

If the user runs `/mapick privacy consent-decline`:
- CONFIG.md gets `consent_declined: true`.
- Remote commands (`recommend` / `search` / `bundle install` / `recommend:track` / `privacy trust` / `report` / `share` / `security` / `security:report` / `clean:track` / `workflow` / `daily` / `weekly`) are refused **client-side** with `error: "disabled_in_local_mode"`.
- Local commands (`status` / `scan` / `clean` reading local mtime only / `uninstall` / `privacy status` / `privacy delete-all` / `privacy log`) keep working.
- `notify` cron is not re-registered on subsequent inits.

To resume data sharing, run `/mapick privacy consent-agree`. Clears the declined flag, re-registers the notify cron, and remote commands work again.

## Auto-trigger on new conversation

Auto-run `bash shell init` when AI detects a new Mapick session (idempotent, 30-min cooldown):
- `first_install` → render per `reference/rendering.md#first_install`.
- `rescanned`, `changed: true` → briefly mention what changed.
- `rescanned`, `changed: false` / `skip` → silent.
