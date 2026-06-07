# Self-Contained Kit Provisioning + Unified Data Directory

**Date:** 2026-06-07
**Status:** Proposed
**Depends on:** Spec B — Managed Compute-Target Images (completes its §3 "auto-provision the kit per host" gap).

## Summary

Two related changes that make Journeyman **self-contained** — no registry, no source shipped at runtime:

1. **Kit as a shipped tar.** A separate pipeline (`npm run build:kit`) builds the kit images
   (`runner-bundle`, `runner-base`) once and `docker save`s them to **tar files**. At runtime the worker
   **loads** the tar onto whatever Docker daemon it's pointed at (`docker load`) when the image is
   missing — it never builds the kit itself, and no registry is involved. This fixes the
   "`pull access denied for journeyman/runner-bundle`" failure: the bundle is loaded from the tar
   instead of pulled.

2. **Unified data directory.** `JOURNEYMAN_BASE_DIR` becomes the single root; `workspaces/`, `skills/`,
   and `kit/` are derived from it. The standalone `SKILLS_CACHE_DIR` is removed (fresh start, no
   back-compat).

## Why

- The kit (`runner-bundle`/`runner-base`) is **local-only** — never pushed to a registry. Before this,
  a box build's `COPY --from=journeyman/runner-bundle:dev` tried to *pull* it → access denied.
- "When we ship the worker, everything it needs is part of it." The worker carries (or is pointed at) a
  pre-built kit tar and loads it onto any daemon — local socket or remote `tcp://` (the tar streams from
  the worker process to the daemon over the Docker API; the daemon never needs the file on its disk).
- One base directory is simpler to reason about and to mount/persist in a container/ECS deploy.

## Design

### 1. Data directory layout (single root)

```
JOURNEYMAN_BASE_DIR/            ← one root (default: ~/.journeyman)
├── workspaces/<runId>/         ← local run workspaces (was <BASE>/<runId>)
├── skills/<name>-<hash>/       ← skill packages cache (was SKILLS_CACHE_DIR)
└── kit/                        ← kit tars: runner-bundle.tar, runner-base.tar
```

- Resolution: `base = process.env.JOURNEYMAN_BASE_DIR ?? join(homedir(), ".journeyman")`.
- `workspaces = base/workspaces`, `skills = base/skills`, `kit = base/kit`.
- **No** `SKILLS_CACHE_DIR` and **no** per-dir overrides (fresh start). One knob: `JOURNEYMAN_BASE_DIR`.
- The base resolver is **backend-local** (orchestrator + skills each derive their subdir). It is **not**
  added to `@journeyman/core` because core is bundled into the browser (no `node:fs/os` there).

### 2. Kit build pipeline (separate job)

`scripts/build-kit.mjs` (run via `npm run build:kit`):
1. `docker build -f docker/runner-bundle.Dockerfile -t <RUNNER_BUNDLE> .`
2. `docker build -f docker/runner-base.Dockerfile   -t <RUNNER_IMAGE> .`
3. `docker save <RUNNER_BUNDLE> -o <out>/runner-bundle.tar`
4. `docker save <RUNNER_IMAGE>  -o <out>/runner-base.tar`

- Output dir: `JOURNEYMAN_BASE_DIR/kit` by default; overridable via `--out <dir>` / `KIT_OUT_DIR`.
- Image names from `RUNNER_BUNDLE` / `RUNNER_IMAGE` (defaults `journeyman/runner-bundle:dev`,
  `journeyman/runner-base:dev`).
- This is the **only** place the kit is built. Run in dev once, or in CI at release time (ship the
  `kit/` folder with the worker). **Multi-arch is future** (name tars per arch, pick by daemon arch).

### 3. Worker "ensure kit" at runtime (load, never build the kit)

A helper in `@journeyman/compute`:

```ts
ensureKitImage(client: IDockerClient, imageName: string, tarPath: string, log?): Promise<void>
// if await client.imageExists(imageName) → return (already there)
// else await client.loadImage(tarPath)   → docker load streams the tar to the daemon
```

Requires a new `IDockerClient.loadImage(tarPath)` (dockerode `loadImage` + `followProgress`).

Called in **two** places (the worker resolves `kitDir = base/kit` and passes tar paths in; compute stays
env-free):

- **Build loop** — before `buildBoxImage` for a `ref`/`dockerfile` target → `ensureKitImage(client,
  RUNNER_BUNDLE, kit/runner-bundle.tar)` so the `COPY --from` graft resolves.
- **Docker provision** — for an **empty-image** target (runs the default box, bypasses the build loop) →
  `ensureKitImage(client, RUNNER_IMAGE, kit/runner-base.tar)` before `docker run`.

If the tar is missing **and** the image isn't present, fail clearly:
`"kit image <name> not found on daemon and no tar at <path> — run 'npm run build:kit'"`.

### 4. Deployment shape (unchanged, now registry-free)

```
[Worker: app + kit/*.tar]  --docker load (local or tcp)-->  [any Docker daemon]
                           --build box / run sandbox-->
```
Works for local socket and remote `tcp://` daemons (ECS → remote dockerd). No registry, no runtime
source. The worker container does **not** contain a Docker engine — it connects to one (the compute
target's address).

## Files

| File | Change |
|---|---|
| `packages/compute/src/backends/docker/docker-client.ts` | Add `loadImage(tarPath)` to `IDockerClient` + `DockerodeClient` |
| `packages/compute/src/backends/docker/ensure-kit.ts` | New `ensureKitImage(...)` helper |
| `packages/compute/src/build/build-loop.ts` | `ensureKitImage` (bundle) before building a box; accept `kitDir`/tar paths |
| `packages/compute/src/index.ts` | Export `ensureKitImage` |
| `packages/orchestrator/src/cli-worker.ts` | Resolve `base`→`workspaces`/`kit`; pass kit tars to build loop; ensure-base on empty-target provision |
| `packages/skills/src/installer.ts` | Derive skills dir from `JOURNEYMAN_BASE_DIR` (drop `SKILLS_CACHE_DIR`) |
| `scripts/build-kit.mjs` | New kit-build pipeline script |
| `package.json` | Add `build:kit` script |
| `.env.example`, `README.md`, `docs/constitution/DEPLOYMENT.md` | Document the single base dir + kit |

## Non-goals / future

- Multi-arch kit tars (pick by daemon arch).
- Optional registry pull as an alternative to the tar (cloud convenience).
- Auto-running `build:kit` in CI (left to the release process).

## Verification

1. `npm run build:kit` → `kit/runner-bundle.tar` + `kit/runner-base.tar` exist.
2. Remove the bundle image from a daemon; a `ref` target build → worker `docker load`s the tar, then
   builds the box → `ready`, image present (no registry pull attempted).
3. Empty-image target on a fresh daemon → `runner-base` loaded from tar, container runs.
4. Tar missing + image absent → build fails with the clear "run npm run build:kit" message.
5. `JOURNEYMAN_BASE_DIR=.tmp` → runs land in `.tmp/workspaces/<runId>`, skills in `.tmp/skills`, kit in
   `.tmp/kit`. Unset → `~/.journeyman/*`.
