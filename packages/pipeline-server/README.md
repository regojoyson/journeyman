# @journeyman/pipeline-server

Fastify HTTP server for `@journeyman/pipeline`. Provides webhook triggers (GitHub, GitLab, Jira, raw API) and a management REST + SSE API for monitoring, cancelling, and resuming pipeline runs.

## Quickstart

```bash
# 1. Create config files
mkdir -p config/flows
# See docs/setup.md for pipeline.yaml and flows/default.yaml content

# 2. Set environment variables
export JOURNEYMAN_API_TOKEN="$(openssl rand -hex 32)"
export GITHUB_ACCESS_TOKEN=ghp_...
export GITHUB_WEBHOOK_SECRET="$(openssl rand -hex 32)"
# export ANTHROPIC_API_KEY=sk-ant-...  # only if NOT logged in via `claude login`

# 3. Start the server
npm start
# or: npx journeyman serve
# or: npx journeyman-server
```

Server listens on the port set in `pipeline.yaml` (default `3000`).

## Webhook routes

| Platform | Route | Auth |
|---|---|---|
| GitHub | `POST /webhooks/github/:productId` | `x-hub-signature-256` HMAC |
| GitLab | `POST /webhooks/gitlab/:productId` | `x-gitlab-token` header |
| Jira | `POST /webhooks/jira/:productId` | `x-hub-signature-256` HMAC |
| Raw API | `POST /api/trigger/:productId` | `Authorization: Bearer` |

All webhook routes return `202 Accepted` immediately; the run executes in the background.

## Management API

All `/api/*` routes (except `/api/health`) require `Authorization: Bearer <JOURNEYMAN_API_TOKEN>`.

| Method | Path | Description |
|---|---|---|
| `GET` | `/api/health` | Health check (no auth) |
| `GET` | `/api/flows` | List registered flows |
| `GET` | `/api/providers` | List registered providers |
| `GET` | `/api/runs` | List runs (`?product=`, `?ticket=`, `?status=`, `?limit=`) |
| `GET` | `/api/runs/:sessionId` | Full run detail |
| `GET` | `/api/runs/:sessionId/logs` | Step trace logs (`?stepId=`, `?tail=N`) |
| `GET` | `/api/runs/:sessionId/stream` | SSE live event stream |
| `GET` | `/api/runs/:sessionId/artifacts/:key` | Download a named artifact |
| `POST` | `/api/runs/:sessionId/cancel` | Cancel a running pipeline |
| `POST` | `/api/runs/:sessionId/resume` | Resume a blocked pipeline |
| `POST` | `/api/human-loop/advance` | Advance a blocked run by `(productId, ticketKey)` |
| `POST` | `/api/trigger/:productId` | Manually trigger a run |

## Key Exports

| Export | Purpose |
|---|---|
| `startServer` | Start and begin listening |
| `buildServer` | Construct Fastify app (for embedding) |
| `buildDispatcher` | Build the trigger → pipeline dispatcher |
| `TicketMutex` | In-process per-ticket dedup lock |
| `ApiTrigger` | Raw API trigger source |
| `GitHubWebhookTrigger` | GitHub HMAC-verified webhook handler |
| `GitLabWebhookTrigger` | GitLab webhook handler |
| `JiraWebhookTrigger` | Jira webhook handler |

## Documentation

Full reference in [`docs/`](../../docs/):

- [Setup guide](../../docs/setup.md) — first-time setup, env vars, webhooks
- [Add a product](../../docs/new-product.md) — add a product to an existing instance
- [Management API](../../docs/management-api.md) — full REST + SSE endpoint reference
- [Triggers](../../docs/triggers.md) — webhook setup per source
- [Security](../../docs/security.md) — token rotation, secret handling
