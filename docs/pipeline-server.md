# @journeyman/pipeline-server

HTTP server layer for `@journeyman/pipeline`. Provides a Fastify-based server with webhook triggers (GitHub / GitLab / Jira / raw API) and a management REST + SSE API for monitoring, cancelling, and resuming pipeline runs.

## Table of contents

- [How it works](#how-it-works)
- [Quickstart](#quickstart)
- [Webhook triggers](#webhook-triggers)
- [Management API](#management-api)
- [Postman collection](#postman-collection)
- [Exports](#exports)
- [Further reading](#further-reading)

---

## How it works

```
Webhook / POST /api/trigger
        │
        ▼
  TriggerSource          validates the request (HMAC, bearer), extracts ticketKey
        │
        ▼
  Dispatcher             dedup check → in-memory mutex → semaphore → load flow YAML
        │
        ▼
  Pipeline.run()         step loop → phases → state persistence → event bus
        │
        ▼
  REST + SSE API         observe runs, stream events, cancel, resume, fetch artifacts
```

The HTTP caller always gets a fast `202 Accepted` — the pipeline run is fire-and-forget.

---

## Quickstart

See [docs/setup.md](./setup.md) for a complete step-by-step walkthrough.

**Short version:**

```bash
# 1. Create config files
mkdir -p config/flows
# populate config/pipeline.yaml and config/flows/default.yaml (see docs/setup.md)

# 2. Set environment variables — .env file or shell exports (both work)
cat > .env <<EOF
JOURNEYMAN_API_TOKEN=<random-secret>     # bearer for management API
GITHUB_ACCESS_TOKEN=ghp_...              # for repo clone, PRs, issues
GITHUB_WEBHOOK_SECRET=<hmac-secret>      # only if wiring real webhooks
# ANTHROPIC_API_KEY=sk-ant-...           # only if NOT logged in via \`claude login\`
EOF

# 3. Start — pick any one
npm start
npx journeyman serve
npx journeyman-server
```

Server listens on the port set in `pipeline.yaml` (default `3000`).

---

## Webhook triggers

| Platform | Route | Auth |
|---|---|---|
| GitHub | `POST /webhooks/github/:productId` | `x-hub-signature-256` HMAC header |
| GitLab | `POST /webhooks/gitlab/:productId` | `x-gitlab-token` header |
| Jira | `POST /webhooks/jira/:productId` | `x-hub-signature-256` HMAC header |
| Raw API | `POST /api/trigger/:productId` | `Authorization: Bearer <token>` |

All webhook routes return `202 Accepted` immediately. The pipeline run starts in the background.

Label gating — if `ticketWorkflow.trigger.matchLabels` is set in the product config, only events whose issue/PR carries one of those labels are processed. Everything else gets `{ "ignored": "label-mismatch" }`.

---

## Management API

All `/api/*` routes (except `/api/health` and `/api/trigger/*`) require `Authorization: Bearer <JOURNEYMAN_API_TOKEN>`.

| Method | Path | Description |
|---|---|---|
| `GET` | `/api/health` | Server health — no auth required |
| `GET` | `/api/flows` | List registered flows (name, providers, step IDs) |
| `GET` | `/api/providers` | List registered providers by category |
| `GET` | `/api/runs` | List runs — filter by `?product=`, `?ticket=`, `?status=`, `?limit=` |
| `GET` | `/api/runs/:sessionId` | Full run detail (steps, artifacts, status) |
| `GET` | `/api/runs/:sessionId/logs` | Trace logs — filter with `?stepId=`, `?tail=N` |
| `GET` | `/api/runs/:sessionId/stream` | SSE stream of live pipeline events |
| `GET` | `/api/runs/:sessionId/artifacts/:key` | Download a named artifact |
| `POST` | `/api/runs/:sessionId/cancel` | Cancel a running pipeline |
| `POST` | `/api/runs/:sessionId/resume` | Resume a blocked pipeline (re-runs the blocked step; see below) |
| `POST` | `/api/trigger/:productId` | Manually trigger a run |

### Resuming a blocked run

`POST /api/runs/:sessionId/resume` resumes a run in the `blocked` state by **re-running the blocked step** — not by skipping past it. This lets a single phase (notably `reviewLoop`) implement a loop by returning `blocked` across multiple resumes and `ok` only when its exit condition is met.

**Request body** (optional, JSON):

```json
{ "ticketStatus": "plan-approved" }
```

| Field | Type | Required | Description |
|---|---|---|---|
| `ticketStatus` | string | No | Literal ticket status value. Placed on `ctx.artifacts.__resumeStatus` so the blocked phase (e.g. `reviewLoop`, `awaitTicketStatus`) can decide whether to return `ok`, re-block, or fail. Cleared after the step returns. |

When no body is provided, the phase is re-run with only `ctx.artifacts.__resumed = true` set — sufficient for the legacy `review` gate, which returns `ok()` on re-entry.

This endpoint is rarely called manually when using `reviewLoop` — the webhook dispatcher routes ticket status-change events to this endpoint automatically via `findActiveForTicket` (see [docs/triggers.md](./triggers.md#status-change-routing)).

**Response:** the updated run object. Returns `409 Conflict` if the run is not in `blocked` state.

### Run status values

| Status | Meaning |
|---|---|
| `running` | Actively executing steps |
| `completed` | All steps finished successfully |
| `failed` | A step failed and `onFailure` was `fail` |
| `blocked` | A step returned `blocked` (waiting on external input) |
| `cancelled` | Run was cancelled via API |

### SSE event types

Subscribe to `/api/runs/:sessionId/stream` to receive:

| Event | Fired when |
|---|---|
| `runStarted` | Run begins |
| `stepStarted` | A step begins (includes phase name, attempt number) |
| `stepEnded` | A step finishes (includes status, duration) |
| `statusChanged` | Run status transitions |
| `runEnded` | Run reaches a terminal state |

Past events are replayed first; new events stream live until the connection closes.

**curl example:**
```bash
curl -N \
  -H "Authorization: Bearer $JOURNEYMAN_API_TOKEN" \
  http://localhost:3000/api/runs/<sessionId>/stream
```

---

## Postman collection

Import [journeyman-pipeline.postman_collection.json](./journeyman-pipeline.postman_collection.json) into Postman.

Set these collection variables before use:

| Variable | Example | Notes |
|---|---|---|
| `baseUrl` | `http://localhost:3000` | Your server URL |
| `bearerToken` | `change-me` | Value of `JOURNEYMAN_API_TOKEN` |
| `productId` | `my-product` | A product key from `pipeline.yaml` |
| `sessionId` | _(auto-set)_ | Auto-populated by the Trigger request test script |

The **Trigger run (API)** request automatically saves the returned `sessionId` into the collection variable so subsequent requests work without manual copy-paste.

---

## Exports

| Export | Purpose |
|---|---|
| `startServer` | Start server and begin listening |
| `buildServer` | Construct Fastify app with all routes (for embedding) |
| `buildDispatcher` | Build the trigger → pipeline dispatcher |
| `TicketMutex` | In-process dedup lock per ticket |
| `ApiTrigger` | Raw API trigger source |
| `GitHubWebhookTrigger` | GitHub webhook handler (HMAC-verified) |
| `GitLabWebhookTrigger` | GitLab webhook handler |
| `JiraWebhookTrigger` | Jira webhook handler |

---

## Further reading

- [Setup guide](./setup.md) — first-time setup, env vars, config files
- [Add a new product](./new-product.md) — add a product to an existing instance
- [Pipeline](./pipeline.md) — flow YAML reference, phase catalog, CLI commands
