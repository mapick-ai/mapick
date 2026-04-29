# Error Handling & Security Red Lines

## Shell Error Codes

| Code | Meaning | AI Action |
|------|---------|-----------|
| `missing_argument` | Required arg missing | Re-prompt |
| `protected_skill` | Tried to uninstall mapick | Refuse |
| `service_unreachable` | Backend down | Suggest retry |
| `disabled_in_local_mode` | Consent declined | Show opt-in |
| `consent_required` | Backend still requires consent unexpectedly | Surface backend message/hint; do not auto-consent |

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

## disabled_in_local_mode

The user previously ran `/mapick privacy consent-decline` and is now in opt-out mode. Refuse the failed remote command and tell the user how to undo:

> You opted out of data sharing earlier. Run `/mapick privacy consent-agree` to resume — that's the same anonymous flow new installs are on.

Do NOT silently retry. Do NOT auto-run `consent-agree` without explicit user consent (that defeats the point of the decline).

## consent_required / backend_consent_failed (HTTP 403)

These should not happen in v0.0.7+ (the client-side gate is opt-out). If the backend still returns 403 after a remote call (e.g. transitional state where backend ConsentGuard hasn't been updated yet), surface the backend's `message` / `hint` directly to the user — do NOT auto-call `consent-agree`. Both errors are passed through verbatim by `httpCall`.
