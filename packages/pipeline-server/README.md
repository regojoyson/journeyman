# @journeyman/pipeline-server

## What it is

`@journeyman/pipeline-server` is the HTTP layer for `@journeyman/pipeline`. Provides a Fastify-based server with webhook triggers (GitHub/GitLab/Jira/raw API) and a management REST+SSE API for monitoring, canceling, and resuming pipeline runs.

## Install

```bash
npm install @journeyman/pipeline-server
```

This is a workspace package; refer to the repo root `package.json` for setup instructions.

## Quickstart

1. **Use the same config:**
   ```bash
   # Same config/pipeline.yaml + config/flows/*.yaml as @journeyman/pipeline
   ls config/pipeline.yaml config/flows/
   ```

2. **Set environment:**
   ```bash
   export JOURNEYMAN_API_TOKEN=<your-api-token>
   export GITHUB_WEBHOOK_SECRET=<optional>
   export GITLAB_WEBHOOK_SECRET=<optional>
   export JIRA_WEBHOOK_SECRET=<optional>
   ```

3. **Start the server:**
   ```bash
   # Via CLI
   npx tsx node_modules/@journeyman/pipeline-server/src/cli-start.ts config/pipeline.yaml
   
   # Via code
   import { startServer } from "@journeyman/pipeline-server";
   await startServer("./config/pipeline.yaml", { port: 3000 });
   ```

## Webhook Setup

Configure your Git/issue tracker to POST to:
- **GitHub**: `POST http://your-host/webhooks/github/<productId>` (Secret: use `GITHUB_WEBHOOK_SECRET`)
- **GitLab**: `POST http://your-host/webhooks/gitlab/<productId>` (Secret: use `GITLAB_WEBHOOK_SECRET`)
- **Jira**: `POST http://your-host/webhooks/jira/<productId>` (Secret: use `JIRA_WEBHOOK_SECRET`)
- **Raw API**: `POST http://your-host/webhooks/api/<productId>` (Bearer token: `JOURNEYMAN_API_TOKEN`)

See [triggers.md](../../docs/pipeline/triggers.md) for detailed setup per platform.

## Management API

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/api/runs` | List all runs |
| `GET` | `/api/runs/<id>` | Get run status |
| `GET` | `/api/runs/<id>/logs` | Stream logs (SSE) |
| `POST` | `/api/runs/<id>/cancel` | Cancel a run |
| `POST` | `/api/runs/<id>/resume` | Resume a paused run |
| `GET` | `/api/products` | List products |
| `GET` | `/health` | Health check |

Full reference: [management-api.md](../../docs/pipeline/management-api.md)

## Exports

| Export | Purpose |
|---|---|
| `buildServer` | Construct Fastify app with routes |
| `buildDispatcher` | Build event dispatcher for runs |
| `TicketMutex` | Distributed lock for concurrent runs |
| `startServer` | Start server and listen |
| `ApiTrigger` | Raw API webhook trigger |
| `GitHubWebhookTrigger` | GitHub webhook handler |
| `GitLabWebhookTrigger` | GitLab webhook handler |
| `JiraWebhookTrigger` | Jira webhook handler |

## Documentation

- [Configuration reference](../../docs/pipeline/configuration.md) — server config, webhook secrets
- [Flows reference](../../docs/pipeline/flows.md) — flow definition
- [Phases catalog](../../docs/pipeline/phases.md) — available phases
- [Triggers guide](../../docs/pipeline/triggers.md) — webhook setup per platform
- [Management API](../../docs/pipeline/management-api.md) — full REST endpoint reference
- [Security](../../docs/pipeline/security.md) — secret handling, rate limiting, RBAC
