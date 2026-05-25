# Webhook Security and Verification

## Overview

Inbound webhooks from GitHub, GitLab, Jira, Monday, and Linear are received at:

- `POST /webhooks/:provider` — legacy per-provider endpoint (still supported)
- `POST /webhooks/in/:tenantToken` — universal endpoint resolving the webhook from the registry

Both go through the same internal router. Each provider signs its payloads differently; Journeyman verifies signatures before processing to prevent spoofing.

---

## Supported Providers

| Provider | Path | Signature Header | Method |
|---|---|---|---|
| GitHub | `POST /webhooks/github` | `X-Hub-Signature-256` | HMAC-SHA256 |
| GitLab | `POST /webhooks/gitlab` | `X-Gitlab-Token` | Shared secret comparison |
| Jira | `POST /webhooks/jira` | Bearer token in `Authorization` | Token comparison |
| Monday | `POST /webhooks/monday` | (provider-specific) | (varies) |
| Linear | `POST /webhooks/linear` | (provider-specific) | (varies) |

---

## Configuring Webhook Secrets

Each provider integration has a webhook secret field in its provider config. Set this to the value you configure in the external provider's webhook settings. The server uses this secret to verify incoming request signatures.

Example provider config (GitHub):

```json
{
  "provider": "github",
  "webhookSecret": "your-secret-here"
}
```

The same pattern applies to GitLab, Jira, Monday, and Linear — each has its own `webhookSecret` field in its respective provider config.

---

## HMAC Verification (GitHub)

GitHub signs each request with `HMAC-SHA256(secret, rawBody)` and sends the hex digest in the `X-Hub-Signature-256` header:

```
X-Hub-Signature-256: sha256=<hex-digest>
```

Journeyman recomputes the digest using the configured secret and rejects requests where the computed value does not match the header value. Requests with a missing or invalid signature receive a `401` response.

---

## Header Sanitization

Before storing webhook payloads, Journeyman strips the following headers to prevent credentials from being persisted in the event log:

- `Authorization`
- Signature headers (e.g., `X-Hub-Signature-256`, `X-Gitlab-Token`)
- `Cookie`

Only the sanitized header set is written to the webhook event record.

---

## Deduplication

Each webhook delivery carries a unique delivery ID (`X-GitHub-Delivery` for GitHub; equivalent identifiers for other providers). Journeyman stores the delivery ID alongside the event record. If the same delivery ID arrives a second time, the server returns `200` but marks the event as `ignored` — no duplicate processing occurs.

---

## Event Routing

After signature verification, the webhook handler processes each event as follows:

1. **Extract an issue reference** — normalizes the payload into a provider-scoped reference:
   - Jira: `jira:PROJ-123` (from `issue.key`)
   - GitHub: `github:owner/repo#42` (from repository + issue/PR number)
   - Monday: `monday:<pulseId>`
   - Linear: `linear:<identifier>`

2. **Check for a pending `webhook-wait`** — if a `webhook-wait` node in an active workflow is waiting on that issue reference, the handler matches it against the node's `listensFor` + `acceptIf` rules, extracts declared outputs via `fromPath`, and resumes the blocked workflow. (Pure `human-task` nodes are **never** resolved by webhooks — they are person-driven only.)

3. **Fall through to workflow trigger matching** — if no `webhook-wait` matches, the handler applies normal workflow trigger matching to decide whether to start a new workflow instance.

See [parallel-and-pauses.md](parallel-and-pauses.md) for details on `human-task` vs `webhook-wait` and the parallel `gateway-and` / `join` node types.

The following fields are examined when extracting event types from the payload:

| Field | Provider |
|---|---|
| `webhookEvent` | Jira |
| `x-github-event` (header) | GitHub |
| `event.type` | Monday / Linear |
| `action` | GitHub (secondary) |

---

## Troubleshooting

| Symptom | Likely Cause | Fix |
|---|---|---|
| `400 "unknown provider"` | Wrong path suffix | Use `/webhooks/github`, `/webhooks/jira`, etc. |
| `401 "invalid signature"` | Secret mismatch or missing header | Verify the webhook secret in provider config matches the value set in the external provider's webhook settings |
| Payload stored but no run triggered | No matching flow or human task | Check flow trigger config and confirm the issue ref format matches what the flow expects |
| Duplicate events marked `ignored` | Repeat delivery from provider | Expected behavior — delivery ID was already processed |
