# Managed Worker Images — Design

**Date:** 2026-06-02
**Status:** Proposed
**Supersedes:** [2026-06-02-docker-deploy-worker-sandboxes-design.md](2026-06-02-docker-deploy-worker-sandboxes-design.md)
(that doc framed the narrow "build runner images in the deploy path" problem; this design
absorbs it into a managed image lifecycle owned by the worker).

## Summary

Today a Docker worker's sandbox image is built **lazily, inside a run** — so a slow or broken
build takes the run down with it, and there is no way to pre-build, rebuild on demand, or clean up
old images. This design moves the image build to be **owned by the worker**: each Docker worker has
an image build **state** (`pending → building → ready | failed`), builds are triggered by
create / update / a manual **Rebuild** action and run in the background on the worker side, runs
**gate** on that state (use-if-ready, wait-if-building, fail-fast-if-failed), the shared **runner
kit is auto-provisioned** (no manual push), and **old images are cleaned up** on rebuild / update /
delete. The design is deployment-agnostic: the worker builds against whatever Docker daemon its
config points at — local socket, a remote daemon on a private network, a DinD service, or a Docker
VM in any cloud (ECS / EKS / AKS / GKE).

## Goals

1. **No manual image chore.** Creating a Docker worker with a custom Dockerfile "just works" — the
   shared runner kit and the per-worker box are both built by Journeyman, with nothing to
   `docker push` by hand.
2. **Build owned by the worker, not the run.** A worker carries its own image build state; builds
   happen ahead of (and independently of) runs.
3. **Controlled updates.** Editing a worker's image/config rebuilds it; a manual **Rebuild** action
   forces a fresh build (covers re-pushed mutable tags). In-flight runs are not disturbed.
4. **Runs never fail just because a build wasn't ready.** A run waits for an in-progress build and
   fails fast — with the real build error — only when the build itself failed.
5. **Cleanup.** Superseded images are removed so disk does not grow without bound.
6. **Works the same locally and in the cloud.** One mechanism, parameterised by the worker's Docker
   connection address.

## Non-goals

- Native per-run **ECS task / Kubernetes pod** execution (the `ecs`/`kubernetes`/`cloud` worker
  types are `status: "planned"` in [worker-type-catalog.ts](../../../packages/workers/src/worker-type-catalog.ts)
  and remain out of scope). Cloud execution here means a `docker` worker dialing a Docker daemon.
- **TLS for remote daemons via the UI.** The worker form captures only the host address today
  ([DockerConfigForm.tsx:104](../../../packages/web/src/components/workers/types/DockerConfigForm.tsx)),
  so remote connections are plain TCP — acceptable on a private network; public/secured daemons need
  a `certDir` field, tracked as a separate follow-up.
- Changing how `local` workers run (still in-process, no image).
- Pushing per-worker built images to a registry (they are built and cached on the target daemon).

## Background — what exists today

- Workers are DB records in `jm_workers` (CRUD in
  [routes/index.ts](../../../packages/workers/src/routes/index.ts); row mapping in
  [worker-record.ts](../../../packages/workers/src/worker-record.ts)). No build-state fields.
- At run start, `resolveWorker` ([resolver.ts](../../../packages/workers/src/resolver.ts)) yields a
  `ResolvedWorker`; the cli-worker's `provisionDocker` calls `resolveDockerSpec`
  ([docker-backend.ts](../../../packages/workers/src/backends/docker/docker-backend.ts)), which —
  for a Dockerfile worker — calls `buildDockerfileImage`
  ([build-image.ts](../../../packages/workers/src/backends/docker/build-image.ts)) **inline during
  provisioning**. The built image is tagged by a content-hash of the wrapped Dockerfile and reused
  if it already exists (`imageExists`).
- `wrapDockerfile` ([dockerfile-wrap.ts](../../../packages/workers/src/backends/docker/dockerfile-wrap.ts))
  appends `COPY --from=<bundleRef> /opt/journeyman …` + baseline apt tools. The `bundleRef`
  (`journeyman/runner-bundle:dev`) must already be resolvable by the daemon.
- `makeDockerClient` ([docker-client.ts](../../../packages/workers/src/backends/docker/docker-client.ts))
  reaches the daemon by the worker's `connection` (`local` socket / `DOCKER_HOST` / `remote`
  tcp+TLS). Per-run containers + volumes are created and destroyed per run; `sandbox-reaper` sweeps
  leaked ones. **Built images are never cleaned up.**

So three things are missing: a build *lifecycle* decoupled from runs, *auto-provisioning* of the
runner kit, and image *cleanup*.

## Design

### 1. Worker image build state (data model)

Add build-state to each Docker worker. The worker row holds the **current desired** state; a
companion table records **per-fingerprint** built images (enables instant rollback and precise
cleanup).

New columns on `jm_workers` (additive migration in `packages/migrations`):

| Column | Meaning |
|---|---|
| `image_state` | `none` \| `pending` \| `building` \| `ready` \| `failed` (null/`none` for `local` workers) |
| `image_fingerprint` | hash of the effective build inputs (wrapped Dockerfile, or the ref string) |
| `image_ref` | the usable tag once `ready` (e.g. `journeyman/jm-built:<fingerprint>`, or the user's ref) |
| `image_error` | last build failure message (when `failed`) |
| `image_built_at` | timestamp of last successful build |

New table `jm_worker_images` (`worker_id`, `fingerprint`, `image_ref`, `state`, `built_at`,
`error`) — one row per fingerprint ever built for a worker. Drives cleanup ("remove rows that are
not the current fingerprint and not in use") and optional rollback.

The fingerprint is computed the same way `buildDockerfileImage` already hashes the wrapped
Dockerfile, extended to include the connection target so the same Dockerfile built against two
daemons is tracked independently.

### 2. Build triggers (the build is owned by the worker)

A build is **enqueued** (worker row → `image_state = pending`, new `image_fingerprint`) on:

- **Create** of a `docker` worker.
- **Update** when the image/config fingerprint changes (the PATCH routes compare the new effective
  fingerprint to the stored one).
- **Manual rebuild** — a new endpoint `POST /api/orgs/:orgId/workers/:id/rebuild` (and the
  user-scoped twin). Forces `pending` even when the fingerprint is unchanged (covers a re-pushed
  mutable `:latest`). Admin-gated like the other mutating worker routes.

Builds are **executed on the worker side**, because that is where the Docker connection lives. A
background **image-build poller** in the orchestrator worker process claims `pending` workers
(claim/mark pattern mirroring `sandbox-store`/`ensureWorkspace` to avoid double-builds across
replicas), sets `building`, runs the build against `makeDockerClient(worker.config.connection)`, and
writes `ready` (+ `image_ref`) or `failed` (+ `image_error`). The api-server only enqueues; it never
needs Docker access.

### 3. Auto-provision the runner kit (no manual push)

Before building a worker's box, the build step **ensures the runner kit exists on the target
daemon**:

- For a **Dockerfile** worker: ensure `runner-bundle` is present (it is the `COPY --from` source). If
  absent, build it on the daemon from the worker process's embedded source (the `runtime-worker`
  image already contains the repo), tag it `journeyman/runner-bundle:<version>`, and cache it. Then
  build the user's box on top (existing `buildDockerfileImage` flow).
- For a **default-box** worker: ensure `runner-base` is present the same way.
- For an **image-ref** worker: nothing to provision — the ref is used as-is (must itself derive from
  `runner-base`).

This `ensureRunnerKit(client, version)` check is idempotent (`imageExists` short-circuits) so the
cost is paid once per daemon. Versioning by the deployed Journeyman version means a Journeyman
upgrade naturally rebuilds the kit and (via §5) retires the old one.

### 4. Run gating

`resolveDockerSpec` / the cli-worker `provisionDocker` path no longer builds inline. Instead, at run
provisioning it reads the worker's `image_state`:

| State (for the current fingerprint) | Run behavior |
|---|---|
| `ready` | Provision immediately using `image_ref`. Fast — no build in the run. |
| `pending` / `building` | Throw a **retryable** error (`WorkerImageBuildingError`). Conductor retries with backoff (existing retry infra), emitting a `step.log` like *"worker image building — waiting"*. The run resumes automatically once the build is `ready`. |
| `failed` | Throw a **terminal** error carrying `image_error`, so the run fails fast with the real build reason instead of a confusing provisioning failure. |
| `none` / fingerprint drift | Enqueue a build (idempotent) and treat as `building` (retryable wait). |

In-flight runs already provisioned against an old image are untouched — they finish on the box they
started with; only new provisions consult the new state.

### 5. Cleanup

- On a successful rebuild to a **new** fingerprint, mark the previous fingerprint's `jm_worker_images`
  row for removal; the **reaper** (extend `sandbox-reaper`) removes images labeled with that worker
  id whose fingerprint is neither current nor backing a live sandbox.
- On **worker delete**, remove all of that worker's built images on its daemon.
- Built images carry a `journeyman.workerId` + `journeyman.fingerprint` label so the reaper can find
  them. A dangling-image safety sweep (by label + age) reclaims anything missed.

### 6. UI

- Worker list / form shows the **image state** (a badge: Building… / Ready / Failed) and, on
  `failed`, the `image_error`.
- A **Rebuild** button on the worker (calls the rebuild endpoint).
- `api/workers.ts` surfaces the new fields; `WorkerFormModal` / `DockerConfigForm` render state and
  the rebuild action. No change to the connection/image inputs themselves.

## Deployment model (local, cloud, other)

The worker builds and runs boxes against whatever its **connection** points at — the design does not
care where that is:

| Where Journeyman runs | Docker daemon the worker dials | Notes |
|---|---|---|
| Laptop / single VM | local socket (default) | nothing extra |
| ECS / EKS / AKS / GKE / any cloud | a Docker VM on the private network, or a DinD service, at `tcp://host:2376` set in the worker's **Remote daemon** connection | runner kit auto-built on that daemon; per-worker boxes built + cached there |

Because the kit and the per-worker box are built **on the target daemon**, no registry push is
required for the base. (A registry is only needed if an org prefers `image-ref` workers pointing at
pre-published images.) The target daemon must be able to reach the npm registry for the one-time kit
build, and must listen on its address (`/etc/docker/daemon.json` `hosts`).

## Files affected (indicative — detailed in the plan)

| Area | Change |
|---|---|
| `packages/migrations` | New migration: image-state columns on `jm_workers` + `jm_worker_images` table. |
| `packages/core` | Extend `WorkerRecord` / `ResolvedWorker` with image-state fields + the build-state union. |
| `packages/workers` | `worker-record.ts` row mapping; fingerprint helper; `ensureRunnerKit`; image-build poller (claim/build/mark); reaper extension for image GC; cleanup on delete. |
| `packages/workers/src/routes` | Rebuild endpoints (org + user); enqueue-on-create/update; expose state in responses. |
| `packages/orchestrator` | `provisionDocker` / `ensureWorkspace` consult image state instead of building inline; `WorkerImageBuildingError` (retryable) + failed (terminal) mapping in the harness. |
| `packages/web` | Image-state badge + Rebuild button; `api/workers.ts` fields. |
| `docker/` + `scripts/` + `.env.example` + `README.md` | Document the cloud/remote daemon setup, the auto-provisioned kit, and `ANTHROPIC_API_KEY` as required for AI steps. |

## Honest caveats / open questions

- **One-time kit build needs npm access on the daemon.** A fully air-gapped daemon needs an npm
  mirror, or the kit pre-loaded.
- **Mutable tags don't auto-refresh.** An `image-ref` worker pointing at `:latest` won't pick up a
  re-push until **Rebuild** is pressed (by design — fingerprint is the ref string).
- **Plain TCP only via the UI** until a `certDir` field is added (private-network assumption).
- **Shared daemon = shared blast radius.** All runs on one daemon share it; hard multi-tenant
  isolation is a later concern.
- **Rollback** via `jm_worker_images` is modeled but a rollback *action* in the UI is optional v1.

## Verification

1. Create a Dockerfile worker against a fresh daemon → worker goes `pending → building → ready`; the
   runner kit and the box are built with no manual push; `docker image ls` shows them.
2. Start a run while the worker is still `building` → the run waits (retryable) and completes once
   `ready`; it never hard-fails on "image missing."
3. Break the Dockerfile, Rebuild → worker goes `failed` with the real error; a run fails fast citing
   that error.
4. Edit the Dockerfile (new fingerprint) → next run uses the new box; the old image is removed by the
   reaper; in-flight runs from before the edit still complete.
5. Delete the worker → its built images are removed from the daemon.
6. Point a worker's connection at a remote `tcp://…` daemon (cloud shape) and repeat (1)–(2).
7. `local` worker still runs in-process (regression).
