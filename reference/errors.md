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

## consent_required (HTTP 403)

Triggered on `recommend` / `search` / `bundle` / `security` when the user
hasn't yet agreed to consent. Render (translate to user's language):

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

## disabled_in_local_mode

User previously declined consent. Refuse:

> You're in local-only mode. Run `/mapick privacy consent-agree 1.0` to enable recommendations / search / bundle / security.

Do NOT silently retry. Do NOT auto-call consent-agree without asking.