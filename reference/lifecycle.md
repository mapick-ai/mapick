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