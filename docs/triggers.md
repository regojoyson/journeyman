# Pipeline Triggers Reference

## Overview

The pipeline supports four trigger sources, each carrying a `productId` from the URL path or request body:

1. **`api`** — Direct HTTP POST with bearer token authentication
2. **`github-webhook`** — GitHub webhook with HMAC-256 signature verification
3. **`gitlab-webhook`** — GitLab webhook with token verification
4. **`jira-webhook`** — Jira webhook with bearer token authentication

Every trigger is normalized into a `PipelineTrigger` shape before dispatch.

---

## Normalized `PipelineTrigger` Shape

```typescript
interface PipelineTrigger {
  source: "api" | "github-webhook" | "gitlab-webhook" | "jira-webhook";
  productId: string;
  ticketKey: string;           // Normalized ticket identifier (e.g., "FOO-123" or "owner/repo#42")
  ticketShortKey?: string;     // Short form (e.g., "123" or "#42")
  flowName?: string;           // Optional: which flow to run (if not specified, use default)
  rawPayload: object;          // Original webhook/request body (sensitive fields redacted)
  timestamp: ISO8601string;
}
```

---

## API Trigger

**Endpoint:** `POST /api/trigger/:productId`

**Authentication:** Bearer token in `Authorization` header

**Request Body:**
```json
{
  "ticketKey": "FOO-123",
  "ticketShortKey": "123",
  "flowName": "review"
}
```

- `ticketKey` (required): Full ticket identifier
- `ticketShortKey` (optional): Short form for UI display
- `flowName` (optional): Which flow to run; if omitted, uses product default

**Response:** `202 Accepted` on success

```json
{
  "sessionId": "sess_abc123xyz",
  "productId": "prod-1",
  "ticketKey": "FOO-123"
}
```

**curl Example:**
```bash
curl -X POST https://your-host/api/trigger/prod-1 \
  -H "Authorization: Bearer your-api-token" \
  -H "Content-Type: application/json" \
  -d '{
    "ticketKey": "FOO-123",
    "ticketShortKey": "123",
    "flowName": "review"
  }'
```

---

## GitHub Webhook Trigger

**Endpoint:** `POST /webhooks/github/:productId`

**Authentication:** HMAC-256 signature via `X-Hub-Signature-256` header

> For webhook security, HMAC verification, and dedup behavior, see [Webhooks](webhooks.md).

### Setup Steps

1. Navigate to your GitHub repository
2. Go to **Settings** → **Webhooks** → **Add webhook**
3. **Payload URL:** `https://your-host/webhooks/github/<productId>`
4. **Content type:** `application/json`
5. **Secret:** Set to the value configured in your provider's `webhookSecret` field
6. **Events:** Select:
   - **Issues** (for issue open/close)
   - **Pull requests** (for PR open/close/sync)
   - **Issue comments** (for discussion)
   - Enable whichever trigger types your flow needs
7. Click **Save**

### Ticket Key Extraction

- **Format:** `<owner>/<repo>#<number>`
- **Short key:** `<number>` (e.g., `42`)

Example: Pull request from `octocat/Hello-World` #42 → `octocat/Hello-World#42`

### Label Gating

If `productConfig.ticketWorkflow.trigger.matchLabels` is set, the webhook only fires if the issue/PR contains **all** listed labels. Example:

```json
{
  "matchLabels": ["auto-run", "pipeline"]
}
```

The issue must have both `auto-run` AND `pipeline` labels or the trigger is ignored.

---

## GitLab Webhook Trigger

**Endpoint:** `POST /webhooks/gitlab/:productId`

**Authentication:** `X-Gitlab-Token` header (constant-time comparison) — see [Webhooks](webhooks.md) for verification details.

### Ticket Key Extraction

- **Default regex:** `/([A-Z]+-\d+)/`
- **Short key:** First matched group
- **Repo info:** `project.path_with_namespace` (e.g., `my-group/my-project`)

Example: Issue description contains `FOO-123` → ticket key is `FOO-123`

### Status Gating

If `productConfig.ticketWorkflow.trigger.matchStatus` is set, the webhook only fires if the issue state matches. Example:

```json
{
  "matchStatus": ["opened", "reopened"]
}
```

The webhook will ignore issues in `closed` state.

### Setup

1. Go to your GitLab project
2. **Settings** → **Webhooks** → **Add webhook**
3. **URL:** `https://your-host/webhooks/gitlab/<productId>`
4. **Secret token:** Set to the value configured in your provider's `webhookSecret` field
5. **Events:** Issues, Merge requests
6. **Save**

---

## Jira Webhook Trigger

**Endpoint:** `POST /webhooks/jira/:productId`

**Authentication:** Bearer token in `Authorization` header — see [Webhooks](webhooks.md) for verification details.

**Setup:** Create a Jira automation rule:

1. Go to **Project Settings** → **Automation**
2. Create a new rule: **When** → pick your trigger (e.g., "Issue created")
3. **Then** → **Send webhook**
4. **URL:** `https://your-host/webhooks/jira/<productId>`
5. **Headers:** Add `Authorization: Bearer <your-secret>`
6. Save

### Ticket Key Extraction

Extracted from `issue.key` field in the webhook payload (e.g., `FOO-123`).

### Status Gating

If `productConfig.ticketWorkflow.trigger.matchStatus` is set, fires only if the status change includes one of the matched values. Example:

```json
{
  "matchStatus": ["In Progress", "In Review"]
}
```

Server checks `changelog.items[*]` where `field === "status"` and matches the `toString` value.

---

## Status-change routing

When a flow uses the `reviewLoop` or `awaitTicketStatus` phase, the ticket status change itself is the human approval signal. The dispatcher detects status-change events on webhooks and automatically resumes the corresponding blocked run — no manual `POST /api/runs/:sessionId/resume` call is needed.

### Event-type classification

Each incoming webhook is classified into one of three `PipelineTrigger.eventType` values (`"new-ticket" | "status-change" | "comment"`) and, for status changes, the literal status value is placed on `PipelineTrigger.newStatus`.

**GitHub** (`github-webhook-trigger.ts`) — GitHub Issues has no first-class status field, so labels are treated as the status primitive:

| GitHub event | `action` | `eventType` | `newStatus` |
|---|---|---|---|
| `issues` | `opened` / `reopened` | `new-ticket` | _(none)_ |
| `issues` | `labeled` / `unlabeled` | `status-change` | `label.name` |
| `issues` | `created` (with `comment`) | `comment` | _(none)_ |
| `issue_comment` | any | `comment` | _(none)_ |
| `pull_request` | `labeled` / `unlabeled` | `status-change` | `label.name` |

**Jira** (`jira-webhook-trigger.ts`) — Jira status transitions arrive as changelog entries on the `issue_updated` webhook:

| Jira `webhookEvent` | Condition | `eventType` | `newStatus` |
|---|---|---|---|
| `jira:issue_created` | — | `new-ticket` | _(none)_ |
| `jira:issue_updated` | `changelog.items[*].field === "status"` | `status-change` | `changelog.items[*].toString` |
| `comment_created` | — | `comment` | _(none)_ |

The literal `newStatus` is passed to the pipeline as-is. Semantic resolution against `productConfig.ticketWorkflow.statuses` happens inside the `reviewLoop` / `awaitTicketStatus` phase.

### Dispatcher routing table

With the trigger classified, the dispatcher decides whether to start a new run, resume an existing one, or drop the event:

| `eventType` | existing run for `(productId, ticketKey)` | action |
|---|---|---|
| `new-ticket` | none | start new run |
| `new-ticket` | any | deduplicate — return existing `sessionId` |
| `status-change` | `blocked` | `pipeline.resume(sessionId, { ticketStatus: newStatus })` |
| `status-change` | `running` / `queued` | ignore (deduplicate) |
| `status-change` | none | ignore (drop — nothing to resume) |
| `comment` | any | (reserved; currently no-op for loop routing) |

Session lookup uses `IStateStore.findActiveForTicket(productId, ticketKey)` — the webhook never needs to carry a `sessionId`.

---

## Trigger Dispatcher Behavior

For every accepted trigger (after signature/auth verification and body parsing):

### 1. Deduplication Check

```
existing = state.findActiveForTicket(productId, ticketKey)
if (existing) {
  return 202 { sessionId: existing.sessionId, ignored: "active-run-exists" }
}
```

- Per-ticket mutex prevents duplicate in-flight dispatches
- If a run is already active for that ticket, return its session ID
- No duplicate pipeline runs are queued

### 2. Concurrency Gating

- Acquires product's semaphore (blocking if at concurrency limit)
- Respects `productConfig.concurrency.maxConcurrent`

### 3. Fire-and-Forget Dispatch

- Calls `pipeline.run()` asynchronously
- Returns `202 Accepted` immediately with session ID
- Actual pipeline execution happens in background

---

## Payload Redaction

Before `rawPayload` is stored in state, sensitive fields are stripped:

| Source | Redacted Fields |
|--------|-----------------|
| GitHub | `sender`, `installation` |
| GitLab | `user` |
| Jira | `user` |
| API | `Authorization` header |

This prevents credential leakage in logs and state storage.

---

## Troubleshooting

| Status | Response | Cause | Resolution |
|--------|----------|-------|-----------|
| `401` | `{ error: "invalid signature" }` | `X-Hub-Signature-256` does not match secret | Verify webhook secret matches config. Rotate in GitHub settings. |
| `401` | `{ error: "unauthorized" }` | Bearer token invalid or missing | Check API token or Jira automation rule auth. |
| `200` | `{ ignored: "label-mismatch" }` | Issue/PR missing required labels | Add required labels in `matchLabels` config, or remove label gating. |
| `200` | `{ ignored: "status-mismatch" }` | Jira/GitLab status doesn't match `matchStatus` | Update issue status or adjust `matchStatus` config. |
| `200` | `{ ignored: "no-ticket" }` | Could not extract ticket key from payload | Ensure ticket key is in issue title/description or Jira `issue.key` field. |
| `404` | `{ error: "product not found" }` | Typo in `:productId` URL parameter | Check product ID in endpoint URL. |
| `500` | `{ error: "no webhook secret configured" }` | Neither per-product override nor env var is set | Set `products.<id>.webhookSecrets.github` or environment variable (e.g., `GITHUB_WEBHOOK_SECRET`). |

---

## Summary Table

| Trigger | Auth | Dedup | Concurrency | Gating |
|---------|------|-------|-------------|--------|
| **API** | Bearer token | Per-ticket mutex | Semaphore | None |
| **GitHub** | HMAC-256 | Per-ticket mutex | Semaphore | Label matching |
| **GitLab** | Token header | Per-ticket mutex | Semaphore | Status matching |
| **Jira** | Bearer token | Per-ticket mutex | Semaphore | Status matching |
