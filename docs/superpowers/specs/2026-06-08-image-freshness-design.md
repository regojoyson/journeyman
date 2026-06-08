# Image Freshness — always run the latest built image

**Date:** 2026-06-08
**Status:** Approved design, pending implementation plan

## Problem

We build Docker images, `docker save` them to tar files (the "kit"), and ship those tars to whatever daemon a worker connects to. When a workflow instance runs, it should always use the **latest** image. Today it does not: if a previous run already loaded an image onto the connected daemon, a freshly rebuilt-and-re-saved tar is silently ignored and the stale image is reused.

### Root cause

The kit images use **fixed mutable tags** — `journeyman/runner-bundle:dev` and `journeyman/runner-base:dev`. The loader, `packages/sandbox/src/backends/docker/ensure-kit.ts`, short-circuits on its first line:

```ts
if (await client.imageExists(imageName)) return;  // never loads the new tar
```

So once `:dev` exists on the daemon, the new tar is never loaded. This bites twice:

1. **Directly** — the default box (`runner-base:dev`, `packages/orchestrator/src/cli-worker.ts:175`) and the graft base (`runner-bundle:dev`, used by the build loop) both go through `ensureKitImage`.
2. **Transitively** — built box images are fingerprinted as `sha256(recipe + bundleId)` where `bundleId = imageId(runner-bundle:dev)` (`packages/sandbox/src/backends/docker/build-image.ts`). Since the bundle's image ID on the daemon never changes, the fingerprint never changes, so user-image boxes are never rebuilt either.

A third gap: user-supplied base refs (`kind:ref` → e.g. `node:20`) are never re-pulled, and the ref's digest is not part of the fingerprint, so an upstream move is invisible.

It is fundamentally a *mutable tag + existence-only check* bug.

## Decisions (locked in)

- **Scope:** everything — kit tars, built boxes, **and** user base refs.
- **Trigger:** per run, but only reload/rebuild when something actually changed (cheap drift detection; near-zero cost when nothing moved).
- **User ref policy:** best-effort `docker pull` of *mutable* refs, skip already-pinned `@sha256:` refs; on pull failure warn and fall back to the local copy; fold the resolved image ID into the box fingerprint so a moved base triggers a rebuild.
- **Dockerfile recipes:** build with `--pull` so base layers stay fresh; accept the limitation that an *upstream-only* `FROM` move will **not** auto-rebuild (a dockerfile box still rebuilds on recipe or kit change). Parsing arbitrary `FROM` lines to fold their digest into the fingerprint was rejected as too complex (multi-stage edge cases).

## Root principle

Replace every *"use the image if it exists"* check with *"use it if it exists **and** matches the current source."* "Current source" is:

- **Kit:** the tar's embedded image ID.
- **Built box:** the freshly-resolved `sha256(effectiveRecipe + bundleId + baseRefId)`.

Detection is cheap; we only reload/rebuild on real drift. **Correctness wins over latency:** the first run after a refresh is *gated* — it briefly waits for the rebuild — rather than allowed to run stale.

## Components

### Component 1 — Kit tar freshness (`packages/sandbox/src/backends/docker/ensure-kit.ts`)

Replace `ensureKitImage` with `reconcileKitImage(client, imageName, tarPath, log?)`:

- Read the tar's image ID from its `manifest.json` (the `Config` entry resolves to the `sha256:…` image id). Stream the tar **headers only**, skipping each entry body via its declared size — cheap even for a 500 MB tar.
- Load the tar when: image **absent** OR loaded `imageId(imageName)` ≠ tar's image ID. `docker load` moves the `:dev` tag to the new image. Running containers keep their pinned image, so live runs are unaffected; only new runs pick up the change.
- **Optional fast-path:** a sidecar marker keyed by tar `(mtime, size)` to skip even the header scan when the file is untouched. Implement only if the header scan proves measurable; otherwise omit.
- **Edge cases (unchanged behaviour):** tar missing + image present → keep the existing image; tar missing + image absent → the existing clear error (`run 'npm run build:kit'`).
- **Corrupt tar:** tar present but `manifest.json` unreadable / no `Config` → hard error (do not silently fall back).

**Call sites:** `cli-worker.ts:175` (default-box provision) and `build-loop.ts` (pre-build kit ensure). Both become per-use, so a refreshed `runner-base` / `runner-bundle` is picked up on the next run.

### Component 2 — Built-box fingerprint (`recipe.ts`, `build-image.ts`)

Extract a shared `resolveBuildInputs(image, client, bundleRef)` →
`{ effectiveRecipe, bundleId, baseRefId, fingerprint, imageRef }`, used by **both** the builder and the freshness check (one definition of "what fingerprint should this box have right now").

- `computeFingerprint` gains the base-ref id: `sha256(effectiveRecipe + "\0" + bundleId + "\0" + baseRefId)`. (For `kind:dockerfile`, `baseRefId` is the empty string.)
- Since `reconcileKitImage` keeps `bundleId` current, a refreshed kit ⇒ new fingerprint ⇒ rebuild — transitively fixing every built box.
- For `kind:ref`:
  - If the ref is pinned (`…@sha256:…`) → no pull; `baseRefId = imageId(ref)`.
  - Else best-effort `docker pull <ref>`; on failure log a warning and continue with the local copy. After the (attempted) pull, `baseRefId = imageId(ref)`.
- For `kind:dockerfile`: pass `pull: true` to `buildImage`. `baseRefId = ""`.
- `buildBoxImage` uses `resolveBuildInputs` to derive the `imageRef` tag and to decide whether a build is needed (`imageExists(imageRef)` short-circuit stays — it is now correct because the tag is content-addressed over the real inputs).

**`IDockerClient` changes:** add `pullImage(ref: string): Promise<void>`; add optional `pull?: boolean` to `buildImage`'s argument object.

### Component 3 — Per-run freshness gate (`packages/orchestrator/src/sandbox/ensure-workspace.ts`)

Add an optional dep `verifyImageFresh(sandboxId, config): Promise<{ fresh: boolean; reason?: string }>`, wired in `cli-worker` using the Docker client.

In the docker run-gating block, when `state === "ready"`:

- Call `verifyImageFresh`. It reconciles the kit (Component 1), best-effort-pulls the ref (Component 2), recomputes the expected fingerprint via `resolveBuildInputs`, and compares it to the stored `image_fingerprint`; it also re-checks that the `jm-built:<fp>` image still exists on the daemon.
- On drift (or missing image) → `markImagePending(sandboxId)` and throw the existing retryable `ImageNotReadyError`. Conductor backs off; the build loop reconciles + rebuilds + marks `ready`; the retry proceeds on the fresh image.
- No drift → fall through unchanged (stamp `__imageRef` and provision).

This is the precise "per run, only if changed" trigger. `verifyImageFresh` is an injected dep so `ensure-workspace` stays pure and unit-testable; the Docker-touching implementation lives in `cli-worker`.

The existing `state === "ready" && !imageRef` pruned-image path is preserved.

### Component 4 — Housekeeping (`packages/sandbox/src/sandbox-instance-reaper.ts`)

Each rebuild orphans the old `jm-built:<oldfp>` image and dangles the previous kit image. Extend the reaper to prune untagged / orphaned `journeyman/jm-built:*` images that are not referenced by any active sandbox instance, so disk usage doesn't grow unbounded as images churn. Never remove an image currently in use by a live container.

## Error handling

- **Pull failure** (offline / private registry) → warn + use local copy; never fails the run.
- **Corrupt / unreadable tar** → hard error.
- **Build failure** → existing `failBuild` → `image_state = 'failed'` → run-gating maps to `ConfigurationError` (fail-fast). Unchanged.
- **Concurrent reconcile** of the same tar across workers → `docker load` is idempotent; worst case both load. Safe.

## Testing

Unit tests (fake `IDockerClient`, no real daemon):

- `computeFingerprint` includes `baseRefId`: different ref id ⇒ different fingerprint; empty ref id stable for dockerfile.
- Tar manifest image-id reader against a small fixture tar (or a mocked tar stream): extracts the `Config` image id; errors on missing `Config`.
- `reconcileKitImage`: absent → load; present & same id → skip (no load); present & different id → reload; tar missing & present → keep; tar missing & absent → throw.
- `resolveBuildInputs`: pinned ref → no pull; mutable ref → pull called; pull throws → continues, fingerprint uses local id; dockerfile → `pull:true` passed to `buildImage`, `baseRefId === ""`.
- `verifyImageFresh` / run-gating: drift → `markImagePending` + retryable `ImageNotReadyError`; fresh → proceeds and stamps `__imageRef`; pruned image (`jm-built:<fp>` absent) → pending + retry.

## Out of scope

- Registry-based image distribution (the kit is deliberately tar-only, never pulls).
- Parsing arbitrary dockerfile `FROM` lines to detect upstream base drift (rejected; see Decisions).
- Changing the `:dev` tag scheme to content-addressed tags (rejected in favour of automatic drift detection).
