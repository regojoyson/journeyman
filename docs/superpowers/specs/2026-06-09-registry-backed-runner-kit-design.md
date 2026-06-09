# Registry-backed runner kit — design

**Date:** 2026-06-09
**Status:** Approved (pending spec review)

## Problem

The runner kit (the prebuilt sandbox images `runner-base` and `runner-bundle`) is
currently distributed as `docker save` tar files on a bind-mounted directory:

- `build:kit` builds both images and `docker save`s them to `<base>/kit/*.tar`.
- The worker bind-mounts that kit dir and, at provision time,
  `reconcileKitImage` compares the **tar's image id** against the daemon's id and
  `docker load`s the tar when absent or stale (the `:dev` tag is mutable, so
  id-comparison is the freshness mechanism).
- The target daemon is dind (`tcp://docker:2375` in compose). The current design
  is explicitly "no registry, no source at runtime."

This works for single-host compose + dind, but does **not** extend to
multi-node / k8s: a bind-mounted tar cannot be the distribution channel to N
workers hitting separate or remote daemons. The k8s worker manifest today has no
kit mount and no daemon wiring — the docker-sandbox path is effectively not
deployable there.

## Goal

Distribute the kit through a **container registry** instead of tar files, so any
number of workers/daemons can obtain the images over the network.

## Decisions (locked)

1. **Bring-your-own registry**, fully configurable via env. Works against a local
   `registry:2`, GHCR, GitLab registry, Docker Hub, ECR — any OCI registry. Journeyman
   does **not** host or ship a registry.
2. **Digest pinning** for freshness (not always-pull mutable tags). The worker pulls an
   exact `@sha256:…` ref, so the hot path is a cheap present-check, reproducible, and free
   of per-provision network round-trips.
3. **DB table is the source of truth** for the current kit version. The publish step
   records digests in the DB; all workers read it and pick up new kits without config
   edits or redeploys.
4. **Optional credentials.** Blank for an open/local registry; username + token for
   private registries (GitLab/GitHub). Credentials are passed to both push and pull.
5. **Full replacement** of the tar path. `docker save`, the `.tar` files, and the
   load-from-tar logic are removed — no offline/tar fallback is kept.

## Config surface (env)

On the worker and the build tooling:

- `JOURNEYMAN_REGISTRY` — registry base/prefix, e.g. `localhost:5000`,
  `ghcr.io/acme`, `registry.gitlab.com/acme/journeyman`.
- `JOURNEYMAN_REGISTRY_USERNAME` — optional.
- `JOURNEYMAN_REGISTRY_TOKEN` — optional.

Image repositories: `<registry>/runner-base` and `<registry>/runner-bundle`.
Effective refs are pinned by digest (`<registry>/runner-bundle@sha256:…`).

## Build & publish flow

Today's `build:kit` is split into two responsibilities so it works whether or not
the DB is reachable when the build runs (it is not, on the first compose run):

1. **`build:kit`** (no DB dependency)
   - `docker build` both images.
   - `docker push` each to `<registry>/…` (with creds if set).
   - Capture each image's `RepoDigest`.
   - Print the digests and write `<base>/kit/kit.json` (`{ base, bundle }` full refs).
   - **Removed:** `docker save` and all `.tar` output.

2. **`register-kit`** (new small CLI; requires DB)
   - Read `<base>/kit/kit.json`.
   - Upsert the two digest refs into the `kit_images` table.
   - Runs **after** Postgres + migrations are up.

### Sequencing

- **compose** (`compose-up.sh`): build+push → bring up Postgres & run migrations →
  `register-kit` → bring up the rest of the stack.
- **CI / k8s**: a job runs `build:kit` then `register-kit` (Postgres reachable),
  identical two-step contract.

## Data model

New append-only migration in `@journeyman/migrations`. One row per kit role
(follows the patterns in `docs/constitution/DATABASE_ARCHITECTURE.md`).

Table `kit_images`:

| column       | type        | meaning                                  |
|--------------|-------------|------------------------------------------|
| `role`       | text unique | `'base'` or `'bundle'`                    |
| `image_ref`  | text        | full pinned ref incl. `@sha256:…`         |
| `updated_at` | timestamptz | last upsert time                          |

`register-kit` upserts by `role`. Workers read both rows.

## Worker pull path

Replaces the tar reconcile entirely:

- `IDockerClient` gains **`pushImage(ref, auth?)`**; **`pullImage`** gains an optional
  `auth` argument. Both build a dockerode authconfig from the registry env vars (or no
  auth when blank).
- `reconcileKitImage` is replaced by **`ensureKitImage(client, ref, auth?)`**: because
  `ref` is digest-pinned, it is a present-check → pull-if-absent. No tar, no id
  comparison, no per-run network call once the layer is cached.
- `cli-worker.ts` resolves the `base`/`bundle` refs **from the `kit_images` table**
  instead of the `RUNNER_IMAGE` / `RUNNER_BUNDLE` constants and `RUNNER_*_TAR` paths
  (today around lines 83–86, 149, 198). The resolved refs feed `ensureKitImage`.
- The box recipe's `COPY --from=<bundleRef>` uses the DB-resolved **bundle digest**.

## Removed code

- `scripts/build-kit.mjs`: the `docker save` half (build/push half stays, extended).
- `packages/sandbox/src/backends/docker/read-image-id-from-tar.ts` (+ its test).
- The tar branch of `packages/sandbox/src/backends/docker/ensure-kit.ts`.
- `RUNNER_BUNDLE_TAR` / `RUNNER_BASE_TAR` paths and the kit-dir bind-mount's tar role
  in `cli-worker.ts`.
- The "(Automatic) The runner kit" tar section of `docs/deploy-docker-compose.md`
  (rewritten for the registry flow).

## Testing

**Unit**
- `pushImage` and the auth-config builder (creds present vs blank).
- `ensureKitImage`: absent → pull; present → skip.
- `register-kit` upsert (insert + update by role).
- Worker reads `kit_images` and feeds refs to `ensureKitImage` / the box recipe.

**Integration**
- Against a throwaway local `registry:2`: build → push → register → pull-by-digest →
  run the default box. Confirms the end-to-end replacement of the tar path.

## Out of scope

- Self-hosted/bundled registry (operator brings their own).
- Always-pull mutable-tag freshness (digest pinning chosen instead).
- Tar/offline fallback (fully removed).
- k8s daemon topology / dind wiring beyond consuming the registry refs (tracked
  separately).
