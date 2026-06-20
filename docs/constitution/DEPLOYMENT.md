# DEPLOYMENT.md — Infra, Migrations & Release Flow

Linked from [AGENTS.md](../../AGENTS.md).

## Local infrastructure

Journeyman depends on PostgreSQL, Redis, and Conductor. The dev dependency stack is `infra/compose.dev.yml` (`npm run infra:up`). The full containerized stack (infra + apps + dind) is `compose.deploy.yml` (`npm run compose:up`); see [deploy-docker-compose.md](../deploy-docker-compose.md).

| Service | Image | Host port |
|---|---|---|
| `postgres` | `postgres:16-alpine` | **5433** |
| `redis` | `redis:7-alpine` | **6380** |
| `conductor` | `orkesio/orkes-conductor-community-standalone` | **8080** (REST), **5001** (UI) |

All services declare healthchecks. Conductor depends on Redis and Postgres being healthy.

```bash
npm run infra:up      # start all three
npm run infra:down    # stop (keeps volumes)
npm run infra:reset   # stop and DESTROY volumes — confirm before running
```

`infra:reset` deletes all local DB state. **Never** run it on a shared environment, and confirm with the user even locally.

## Database migrations

```bash
npm run migrate
# expands to:
#   DATABASE_URL=${DATABASE_URL:-postgres://postgres:postgres@localhost:5433/journeyman} \
#   npm run migrate -w @journeyman/migrations
```

The `@journeyman/migrations` package exposes a `journeyman-migrate` CLI (declared in its `bin` field) that applies SQL migrations against `DATABASE_URL`.

Rules:
1. Migrations live under `packages/migrations/`.
2. Migrations are **append-only** once merged to `master`. To revert, write a new forward migration.
3. Every schema change ships in the same PR as the code that depends on it.
4. Migrations must be safe under concurrent writes (no implicit multi-hour table locks, no `NOT NULL` on populated columns without a documented backfill).
5. Destructive migrations (drop column/table) require explicit user approval and a documented rollback plan.

## Environment configuration

A committed `.env.example` documents required variables. The `.env` file itself is gitignored. Key variables (non-exhaustive):

| Variable | Purpose |
|---|---|
| `DATABASE_URL` | Postgres connection string (defaults to local `:5433/journeyman`). |
| `PORT`, `LOG_LEVEL` | API server config. |
| `JWT_SECRET`, `IDENTITY_ENFORCE`, `ACCESS_TOKEN_TTL_SECONDS`, `REFRESH_TOKEN_TTL_SECONDS` | Identity / auth. |
| `JM_SECRET_ENCRYPTION_KEY` | AES key for the user/org secret vault. |
| `JM_GLOBAL_*` | Global secret overrides (prefix pattern). |
| `ANTHROPIC_API_KEY` | Optional; falls back to logged-in `claude login`. |
| `GITHUB_ACCESS_TOKEN` | Legacy fallback for GitHub access. |
| `JOURNEYMAN_BASE_DIR` | Single data root: `<base>/{workspaces,skills,kit}` (default `~/.journeyman`). |
| `JOURNEYMAN_REGISTRY` | Registry the runner kit is pushed to / pulled from (e.g. `localhost:5500` bundled, `ghcr.io/acme`). Publish with `npm run build:kit && npm run register-kit`. |
| `JOURNEYMAN_REGISTRY_USERNAME`, `JOURNEYMAN_REGISTRY_TOKEN` | Optional registry credentials (blank for open/local registries). |
| `JOURNEYMAN_RUNNER_BUNDLE`, `JOURNEYMAN_RUNNER_IMAGE` | Optional fallback kit refs used only when the `kit_images` table has no row yet. |
| `WORKER_ID`, `RUN_SYNC_INTERVAL_MS`, `CYCLE_VISIT_LIMIT`, `WORKER_POLL_INTERVAL_MS`, `CONDUCTOR_BASE_URL` | Worker / orchestrator. |
| `WORKER_DEFAULT_STEP_TIMEOUT_S` | Safety-net timeout for steps that do not set `timeoutSeconds` in node config. Default `1800` (30 min). Set lower in test environments to surface hangs faster. |
| `SLACK_BOT_TOKEN`, `ATLASSIAN_API_TOKEN` | Optional integrations. |

When adding a new env var:
1. Add it to `.env.example` with a placeholder and short comment.
2. Read it through a typed config helper, not raw `process.env` scattered through code.
3. Update [SECURITY.md](SECURITY.md) if it carries credentials.

## Running services locally

```bash
npm run start:api-server     # Fastify gateway
npm run start:worker         # tsx packages/orchestrator/src/cli-worker.ts
npm run dev:web              # web UI in dev mode
npm run build:web            # web UI production build
```

## Release / deployment status

**There is currently no CI pipeline** (`.github/workflows/` and `.gitlab-ci.yml` are absent) and no automated deployment. Until one is wired up:

- "Release" effectively means **merging to `master`** plus, optionally, tagging.
- Versioning convention (SemVer, branch model) is described in [VERSION_MANAGEMENT.md](VERSION_MANAGEMENT.md). Today all packages are locked at `0.1.0`; treat any bump as a deliberate, user-authorized change.
- If/when a CI workflow lands, it should at minimum run `npm run check` and `npm test`.

## Rollback

- **App rollback:** redeploy the previously-built artifact (once a build pipeline exists).
- **DB rollback:** forward migrations only. Author a corrective migration; do not run `down`.
- Communicate any rollback in the team channel before acting.

## What AI agents must NOT do

- Run `npm run infra:reset` without explicit user confirmation in the current session.
- Run migrations against any non-local `DATABASE_URL`.
- Push tags or trigger deployments.
- Add or modify CI/CD workflow files without explicit approval — these affect every contributor.
- `git push --force` to `master` or any release branch.
- Print or log the values of `JWT_SECRET`, `JM_SECRET_ENCRYPTION_KEY`, `ANTHROPIC_API_KEY`, `GITHUB_ACCESS_TOKEN`, or any `JM_GLOBAL_*` variable.

## Observability

- API logs: stdout, structured JSON.
- Worker logs: stdout, include `runId` and `stepId` for correlation.
- When debugging, always include the `runId` in queries; never grep across all runs blindly.
