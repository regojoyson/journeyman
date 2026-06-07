# Spec B — Managed Compute-Target Images

**Date:** 2026-06-03
**Status:** Proposed
**Depends on:** Spec A (Compute Target rename — landed) + Spec A.2 (slim `agent-runtime` + bundled providers).
**Supersedes:** 2026-06-03-workflow-images-managed-boxes-design.md (pivoted from *image-on-workflow* to
*image-on-compute-target* — **Model 1** — for simplicity; keeps the same value with far less machinery).

## Summary

A **Compute Target is a named, ready-to-run environment = connection + image.** It holds *where* jobs
run (a Docker address, or `local` = in-process) **and** *what's in the box* (a Dockerfile, a base-image
ref, or nothing → the plain kit). A **workflow simply picks a compute target** (a default, with an
optional per-step override). Journeyman **builds and maintains each compute target's box** on top of a
shared per-host **runner kit** (Spec A.2), with a visible build **state** (`pending → building →
ready | failed`), a **Rebuild** action, **run-gating** (use / wait / fail-fast), and **cleanup**.
Provider (Claude/OpenCode/…) is a **runtime toggle + per-step API key** (Spec A.2), never part of the
image. Per-run isolation is preserved (every run gets its own throwaway container + volume).

This is the **current code's model**, made managed. It deliberately drops *per-workflow images* and
*per-step image overrides* (their complexity outweighed the benefit; see "Why Model 1").

## Why Model 1 (image on the compute target)

- **One entity to reason about** — "an environment" — instead of (target + per-workflow image + per-node
  override). Matches the code we already have.
- **Few boxes, not many** — one box per *compute target* (a handful), not one per *workflow* (many).
  The build lifecycle, fingerprints, and cleanup attach to those few targets.
- **No loss of isolation** — each **run** still gets its own container + volume from the target's
  (read-only) image, so runs never affect each other. The earlier "sharing breaks other workflows"
  fear doesn't materialize for a read-only shared image.
- **Per-workflow-appropriate tools still work** — you express them by **picking/creating the right
  compute target** ("Python @ host-X", "Node @ host-X"), like CI runner labels. A `.NET` workflow
  picks the `.NET` target; a Java one picks the Java target.
- **Trade-offs accepted:** image-variant targets repeat the connection address (minor); no per-step
  *image* override (a step can still override the *target* — see §2; full per-step image is a future
  option).

## Mental model

```
   Compute Target "Python @ host-X"  = connection (tcp://host-X:2376)  +  image (FROM python:3.12 …)
   ┌───────────────────────── host-X ─────────────────────────────────┐
   │  runner kit  (Node + runner + git + ALL provider engines)  ← shared, built/pulled once          │
   │     └─ box(Python @ host-X) = kit + the target's image recipe      ← ONE box per compute target  │
   └────────────────────────────────────────────────────────────────────┘
   A workflow picks a compute target. Per run: a fresh throwaway container + volume from its box.
   Provider = runtime toggle inside the box + an API-key env var.
```

## Design

### 1. Compute Target = connection + image + build state

A compute target record holds:
- **type:** `local` (in-process, no Docker, no image) or `docker`.
- **connection (docker):** a single **Docker address** field (`tcp://host:2376`), stored as
  `connection: { kind: "remote", host }` — the local-socket/remote dropdown is dropped (todo #28).
  TLS certs are a follow-up (todo #29); until then remote = private network only.
- **image (docker):** `{ kind: "preset", preset }` | `{ kind: "ref", imageRef }` |
  `{ kind: "dockerfile", content }` | empty → the plain runner kit (default box).
- **network / resources / env** (unchanged).
- **build state (new):** `image_state` (`none|pending|building|ready|failed`), `image_fingerprint`,
  `image_ref`, `image_error` (captured build log), `image_built_at`, plus claim/lease columns.

The form is **type-driven**: a `local` target shows no image fields; a `docker` target shows the
address + image source + a build-state badge + a **Rebuild** button + a manual **Clean up images**
action (todo #23).

### 2. Workflows pick a compute target

- **Workflow default:** a "Run target" tab picks the default compute target.
- **Per-step override:** a step may override the compute target — **workspace-independent steps only**
  (a workspace step would lose the shared clone if it ran on a different box). This single mechanism
  also covers "this step needs a different image" (pick a target that has it). Full per-step *image*
  override (different image, same shared workspace) remains a **future option** (todo #25).
- No image config on the workflow or step — the image comes with the chosen target.

### 3. The runner kit (shared, per host) — from Spec A.2

The kit (slim `agent-runtime` + all provider engines + git) is **auto-provisioned once per host** —
built on the daemon from the worker's embedded source, or (preferred for cloud) **pulled from a
registry**. It is **versioned**. A compute target's box is built on top of it.

### 4. Box identity & build lifecycle (per compute target)

- **Identity:** `(computeTargetId, recipeFingerprint, kitVersion)`. `recipeFingerprint` = hash of the
  effective wrapped Dockerfile (a `ref` is treated as a one-line `FROM <ref>`; both **always graft the
  kit** on top — the kit is the mandatory base; the runner stays provider-agnostic). One box per
  compute target (per fingerprint/kit).
- **Triggers:** building or editing a compute target's image (fingerprint changes) → `pending`; a
  manual **Rebuild** forces `pending` (covers re-pushed mutable `:latest`).
- **Executor:** a background loop in the **worker** (holds the Docker connection). It **claims** a
  pending target's box (atomic DB update), **leases** it (timeout + heartbeat so a crash doesn't wedge
  it), **ensures the kit** on the host, builds, then writes `ready` (+ image ref) or `failed` (+
  captured build log). **Stale-build guard:** commit only if the fingerprint is still current.

### 5. Run-gating (use / wait / fail-fast)

When a run resolves its compute target, it consults that target's box state for the current
fingerprint/kit:

| State | Run behavior |
|---|---|
| `ready` | provision immediately from the box image |
| `pending` / `building` | **retryable** wait — Conductor backs off; emits `step.log` "preparing environment (building image)…"; resumes when ready |
| `failed` | **terminal** — fail fast with the captured build log |
| missing at provision (pruned / TOCTOU) | treat as not-ready → re-enqueue build + wait |
| **infra** (daemon unreachable / no worker) | **retryable** + clear message ("can't reach Docker at `<host>`" / "no worker to build") — NOT a terminal build failure |

In-flight runs already on an older box finish on it; only new provisions consult the new state.

### 6. Cleanup

- On a compute target's image edit (new fingerprint) or **target deletion**, remove that target's old
  box images on its host. One box per target ⇒ simple; no cross-entity refcount.
- Never remove an image a **container** is using (Docker enforces it); a dangling/age sweep (extend the
  sandbox reaper) reclaims the rest. Manual **Clean up images** action per target (todo #23).

### 7. Provider = runtime toggle (Spec A.2)

Every box has all engines (from the kit). The workflow/step toggles the provider; the matching API key
arrives as a **per-step env var** from secrets. Switching providers never rebuilds a box. Each provider
must be registered in `PROVIDER_CATALOG` with its key slot (`opencode` is missing today).

### 8. Git auth in the box (todo #24, provider-agnostic)

Build the **authed clone URL via the git provider** (GitHub `buildCloneUrl`; others their own — **no
host hardcoding in the runner**) and clone with it. The token persists in `remote.origin.url`, so the
AI agent's own `git commit`/`push` also authenticate with no extra setup. The runner stays generic and
**redacts** `//user:secret@` in logs. (Caveat = local today: token sits in the box's `.git/config`.)

### 9. Deployment (compose / ECS)

The **compute target's address is the whole story** — no compose/ECS-level Docker config is needed; the
worker just needs network access to the address. **Local** targets need zero infra (in-process). On
**ECS**: the worker is a task with no host Docker → use a **remote** Docker daemon (private subnet) +
the **kit prebuilt in a registry** the daemon pulls. "Deploy on ECS" runs the *stack* on ECS; jobs run
**Local** or on a **Docker daemon you provide** (no native ECS-task-per-run yet). Scale by adding more
compute targets (more Docker hosts).

## UX & governance (from the business-process dry-run)

- **Image presets (todo / B1):** the compute target's image offers **curated presets** ("Python 3.12",
  "Node 20", "Java 21", "TypeScript") as the default choice, with **raw Dockerfile / ref as advanced**.
  Since compute targets are typically admin-curated, this fits well — most authors just *pick a target*.
- **Governance (B3):** creating/pointing a **Docker** compute target = an address to a root-level daemon
  **and** an arbitrary Dockerfile that runs **arbitrary build-time code on shared infra** (T2). On
  shared/prod, **restrict compute-target creation to admins**; users *pick* from approved targets.
- **Secrets pre-flight (B2):** before a run (or at save), check the needed **provider key + git token**
  are set; warn clearly ("set your Anthropic key + GitHub token in Secrets") instead of a vague run
  failure.
- **First-run UX (B4):** when a target's box is `building`, show "**Preparing environment (building
  image)… happens once**" rather than letting the run look stuck.
- **Warn-on-delete (#26):** deleting a compute target in use → confirm ("N workflows use this").

## Upgrades (kit-version bump)

A box's identity includes `kitVersion`, so a **Journeyman upgrade** rebuilds boxes onto the new kit.
Because there's **one box per compute target** (a handful), an upgrade rebuilds **only those few** — not
a per-workflow wave. Optional **pre-warm** rebuild after upgrade so the first run doesn't wait.

## Data model (indicative)

- `jm_compute_targets`: add `image_state`, `image_fingerprint`, `image_ref`, `image_error`,
  `image_built_at`, `build_owner`, `build_lease_until`. The `config.image` field stays on the compute
  target (it's already there in code) — now backed by the build lifecycle.
- No `jm_built_boxes` table and no per-workflow image fields are needed (the per-workflow design's
  table is dropped).
- Workflow/flow JSON: `computeTargetId` (default + per-node) only — **no** image fields.

## Non-goals / future

- **Per-workflow images** and **per-step *image* overrides** (different image sharing one workspace) —
  dropped now; future option (#25) if a real need appears.
- Native ECS-task / K8s-pod per-run (compute types `planned`).
- TLS-cert UI for remote Docker (#29).
- Cross-workflow image dedup is N/A (boxes are per compute target, naturally shared by any workflow
  that picks the target — safely, read-only).

## Verification

1. Create a `docker` compute target with a Python image → it goes `pending → building → ready`; kit
   auto-provisioned; box built once.
2. Two workflows pick that target → both run, sharing the read-only image, each with its own
   container/volume. Different providers per workflow work (toggle + key), no rebuild.
3. Start a run while the target's box is `building` → it **waits** then runs; broken Dockerfile →
   `failed` with the real log; run fails fast citing it.
4. Edit the target's image → next run uses the new box; old box reclaimed; in-flight runs finish on the
   old one.
5. Private-repo clone **and** the agent's `git push` both authenticate in the box (provider-built
   authed URL).
6. Delete the target → its box images removed; warn if workflows use it.
7. `local` compute target → runs in-process, no Docker, image fields hidden.
8. Cloud: remote `tcp://` target + registry-pulled kit → (1)–(3) pass with no source-shipping.
