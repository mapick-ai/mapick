# Error Handling & Security Red Lines

## Shell Error Codes

| Code | Meaning | AI Action |
|------|---------|-----------|
| `missing_argument` | Required arg missing | Re-prompt |
| `protected_skill` | Tried to uninstall mapick | Refuse |
| `service_unreachable` | Backend down | Suggest retry |
| `disabled_in_local_mode` | Consent declined | Show opt-in |
| `consent_required` | First install | Run consent flow |

## Security Red Lines (MANDATORY)

| Scenario | Required Action |
|----------|-----------------|
| Grade C skill | **DO NOT show install button.** Show alternatives + red warning. User must acknowledge. |
| `delete-all` request | **Re-state destructive scope.** Require second confirmation before executing. |
| Local-only + recommend/search | Refuse with "requires consent" |
| Empty search results | Show fallback template |

## Bundle Failure Playbook

| Failure | Action |
|---------|--------|
| `clawhub not found` | Stop; link openclaw.io; ask retry |
| Network timeout | Skip current, continue; summarize |
| Permission denied | Report path; suggest sudo |
| "already installed" | Count as success |

Render errors in user's language. Never echo JSON.