# Durable (host-mounted) Database Volumes — Design

**Date:** 2026-06-08
**Status:** Approved (design) — implementation plan pending

## Goal

Make postgres/redis data **durable across redeploys and resets**: `compose:reset`
(`docker compose down -v`) — or even a raw `down -v` — must **not** wipe the database.
Only an explicit command may destroy it. Data lives on a **host folder** so it's visible
and backup-able.

## Decision

Move postgres and redis data from project-managed named volumes to **host bind-mounts**
under the existing single data root `JOURNEYMAN_BASE_DIR`. `dind-storage` stays a
project-managed named volume (safe to wipe/rebuild). Bind-mounts are never removed by
`docker compose down -v`, so the DB survives every compose lifecycle command. A one-time
migration copies existing named-volume data into the host folders so nothing is lost.

(Chosen over external named volumes because the user wants the data on a host path. macOS
Docker-Desktop bind-mounts for postgres work via uid mapping — slightly slower than a named
volume, acceptable at this scale.)

## Changes

### 1. `compose.deploy.yml`
```yaml
  postgres:
    volumes: ["${JOURNEYMAN_BASE_DIR:-./.journeyman-data}/postgres:/var/lib/postgresql/data"]
  redis:
    volumes: ["${JOURNEYMAN_BASE_DIR:-./.journeyman-data}/redis:/data"]
volumes:
  dind-storage: {}          # remove `pgdata` and `redisdata`
```
The bind-mount source interpolates `JOURNEYMAN_BASE_DIR` from `.env` (default
`./.journeyman-data`), matching the worker's existing mount.

### 2. `scripts/compose-up.sh`
Before `docker compose … up`, ensure the host folders exist (replaces nothing else —
secret check, kit build, and image build are unchanged):
```bash
mkdir -p "$data_dir/postgres" "$data_dir/redis"
```
(`$data_dir` is the already-derived `JOURNEYMAN_BASE_DIR` value, default `./.journeyman-data`.)

### 3. `package.json` scripts
```json
"compose:reset":   "docker compose -f compose.deploy.yml down -v",
"compose:wipe-db": "docker compose -f compose.deploy.yml down && rm -rf \"${JOURNEYMAN_BASE_DIR:-./.journeyman-data}/postgres\" \"${JOURNEYMAN_BASE_DIR:-./.journeyman-data}/redis\""
```
- `compose:reset` (`down -v`) now removes only `dind-storage`; the host `postgres/`+`redis/`
  folders are untouched (bind-mounts aren't volumes). **DB survives.**
- `compose:wipe-db` is the **only** path that destroys DB data: bring the stack down (release
  the folders), then delete them.

### 4. One-time migration — `scripts/migrate-db-to-host.sh`
Run once, stack **down**, before the first `compose:up` on the new config. Resolves
`JOURNEYMAN_BASE_DIR` from `.env`, then:
```bash
docker compose -f compose.deploy.yml down            # release named volumes (NO -v)
mkdir -p "$data_dir/postgres" "$data_dir/redis"
docker run --rm -v journeyman-deploy_pgdata:/from    -v "$data_dir/postgres":/to alpine sh -c 'cp -a /from/. /to/'
docker run --rm -v journeyman-deploy_redisdata:/from -v "$data_dir/redis":/to    alpine sh -c 'cp -a /from/. /to/'
```
`cp -a` preserves the postgres uid/permissions so the DB starts cleanly on the host folder.
The old named volumes are left intact as a fallback. The script is a no-op-safe to re-run
(it overwrites the host copy), but is intended as a one-time step. Add an npm alias
`"migrate-db-to-host": "./scripts/migrate-db-to-host.sh"`.

### 5. Docs
README + `docs/deploy-docker-compose.md`: DB data lives at `$JOURNEYMAN_BASE_DIR/{postgres,redis}`
on the host; `compose:reset` is data-safe; `compose:wipe-db` is the explicit destroy; document
the one-time `migrate-db-to-host` step for existing deployments.

## Behavior

| Command | postgres/redis (host folders) | dind-storage |
|---|---|---|
| `compose:up` / `compose:down` | preserved | created / kept |
| `compose:reset` (`down -v`) | **preserved** ✅ | wiped |
| `compose:wipe-db` | **deleted** (explicit) | kept |

## Deploy order (existing deployment)
```
git pull
docker compose -f compose.deploy.yml down     # stop, keep old named volumes
npm run migrate-db-to-host                     # copy data into host folders
npm run compose:up                             # postgres/redis use host folders, data intact
```
Fresh deployment (no prior data): skip the migration — `compose:up` creates empty
`postgres/`+`redis/` folders and postgres `initdb`s normally.

## Caveats
- macOS Docker-Desktop bind-mount for postgres works via uid mapping (usually fine); slightly
  slower than a named volume. On Linux the host folder must be writable by the postgres uid
  (`cp -a` from the migration preserves ownership; fresh dirs are created root-owned and
  Docker Desktop maps them — verify on first boot).
- The worker mounts the same `JOURNEYMAN_BASE_DIR`, so it will *see* `postgres/`+`redis/`
  sibling folders alongside `workspaces/` and `kit/`. Harmless — the worker never reads them.

## Out of scope
- The `--apps-only` redeploy flag (deferred; durable volumes already make redeploys data-safe).
- Switching the dev stack (`infra/compose.dev.yml`) to host mounts.
- Automated DB backups.
