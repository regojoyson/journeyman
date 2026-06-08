# Local Infra (dev dependency stack)

`compose.dev.yml` — Postgres, Redis, Conductor only. Use this when you run
api-server/worker/web on your host via npm. For the **full** containerized stack
(infra + apps + built-in Docker engine) see [`../compose.deploy.yml`](../compose.deploy.yml)
(`npm run compose:up`) and [`../docs/deploy-docker-compose.md`](../docs/deploy-docker-compose.md).

## Bring up

```bash
npm run infra:up        # docker compose -f infra/compose.dev.yml up -d
npm run migrate         # apply Journeyman SQL migrations against Postgres
```

## URLs

- Conductor REST: http://localhost:8080/api
- Conductor UI:   http://localhost:5000
- Postgres:       postgres://postgres:postgres@localhost:5433/journeyman
- Redis:          redis://localhost:6380

## Bring down

```bash
npm run infra:down      # docker compose -f infra/compose.dev.yml down
npm run infra:reset     # docker compose -f infra/compose.dev.yml down -v   (DESTROYS volumes)
```

## Phase 1 smoke test

```bash
npm run infra:up
npm run migrate
npm run start:api-server &
npm run start:worker &

# Create flow
curl -X POST http://localhost:4000/flows \
  -H 'Content-Type: application/json' \
  -d @examples/flows/analyze-only.flow.json

# Submit a run (replace <FLOW_ID> with the id printed above)
curl -X POST http://localhost:4000/flows/<FLOW_ID>/runs \
  -H 'Content-Type: application/json' \
  -d '{"inputs":{"dirPath":"/path/to/repo","ticketContent":"# Hello"}}'

# Inspect the run
curl http://localhost:4000/runs/<RUN_ID>
```
