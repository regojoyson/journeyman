# Spec B — Workflow Images & Managed Per-Workflow Boxes

**Date:** 2026-06-03
**Status:** SUPERSEDED by 2026-06-03-managed-compute-target-images-design.md — pivoted to Model 1 (image on the Compute Target). Kept for history.
**Depends on:** Spec A (Compute Target rename, landed) + Spec A.2 (slim `agent-runtime` + bundled providers).
**Supersedes:** 2026-06-02-managed-worker-images-design.md (re-homed onto the Compute Target / workflow-image model).

## Summary

Move the image (Dockerfile/ref) **off the Compute Target and onto the workflow**: a Compute Target is
**connection only** (where Docker is), reused by many workflows; each **workflow** declares its **own
image** — a workflow-level default plus an optional per-step override, each in a **new "Image" tab**.
Every workflow gets its **own private box** (no cross-workflow sharing). Boxes are built **ahead of
time** on the Compute Target's host, on top of a **shared runner kit** (from Spec A.2) that is
auto-provisioned once per host. Each box carries a **build state** (`pending → building → ready |
failed`); runs **use** a ready box, **wait** on a building one, and **fail fast** on a failed one.
Old boxes are **cleaned up** per workflow. Provider choice is a **runtime toggle** (Spec A.2), not
part of image identity. Works the same locally and in the cloud (ECS/EKS): for cloud, the kit is a
**prebuilt image the daemon pulls from a registry**, with build-from-source as the local/dev
fallback.

## Mental model (the agreed picture)

```
   Compute Target CT1  =  "Docker at tcp://host:2376"   (connection only; shared)
   ┌───────────────────────── host ─────────────────────────────────┐
   │  runner kit  (Node + runner + git + ALL provider engines)        │ ← shared, built/pulled ONCE
   │     ├─ box(Workflow A)  = kit + A's image recipe                  │ ← A's own box
   │     ├─ box(Workflow B)  = kit + B's image recipe                  │ ← B's own box
   │     └─ box(Workflow A / step S override) = kit + S's recipe       │ ← extra box for an overriding step
   └──────────────────────────────────────────────────────────────────┘
   Per run: a throwaway container + volume started from the workflow's box.
   Provider (Claude/OpenCode/…): a runtime toggle inside the box + an API-key env var.
```

- **Shared per host:** the machine (CT) + the runner kit (all engines).
- **Per workflow:** its own box(es). Even identical recipes do **not** share across workflows.
- **Per run:** a fresh container + volume from the workflow's box.

## Goals

1. Compute Target = connection only; one CT serves many workflows.
2. Image lives on the **workflow** (default) with an optional **per-step override**, each in a new tab.
3. **Per-workflow isolation:** each workflow owns its box; no cross-workflow coupling.
4. Boxes are built **ahead of runs**, with a visible **state**; runs **wait** (not fail) while
   building and **fail fast with the real error** if a build broke.
5. **Manual Rebuild** action; edits rebuild automatically.
6. **Cleanup** of superseded boxes (simple — per-workflow ownership means no cross-workflow
   refcount).
7. Same mechanism locally and in cloud; **adding a workflow/provider later never disturbs existing
   workflows.**

## Non-goals

- Cross-workflow image sharing / dedup (explicitly dropped for isolation; could be opt-in later).
- Per-provider packages or an enabled-set (Spec A.2 bundles all providers).
- Native ECS-task / K8s-pod per-run execution (`ecs`/`kubernetes` compute types remain `planned`);
  cloud here means a `docker` Compute Target dialing a Docker daemon.
- TLS-cert entry in the Compute Target form (private-network plain TCP for now; separate follow-up).

## Design

### 1. Image config moves to the workflow

- **Workflow default image** — a new **Image tab** in the flow/workflow config (next to the default
  Compute Target picker). Holds `{ kind: "ref", imageRef }` or `{ kind: "dockerfile", content }`, or
  empty → use the plain runner kit (default box).
- **Per-step override** — a new **Image tab** on each step node; same shape; empty → inherit the
  workflow default.
- The Compute Target's `config` keeps **only connection** (`connection`, `network`, `resources`,
  `env`). Its `config.image` is **removed**.

### 2. The runner kit (shared, per host) — from Spec A.2

- The kit (slim `agent-runtime` + all provider engines + git) is **auto-provisioned once per host**:
  built on the daemon from the worker's embedded source, **or** (preferred for cloud) **pulled from a
  registry** as a prebuilt image. Controlled by `JOURNEYMAN_RUNNER_IMAGE` / `JOURNEYMAN_RUNNER_BUNDLE`.
- It is **versioned** (by Journeyman version / kit contents). Rebuilt only on: first use on a host,
  Journeyman upgrade, or deletion. **Existing workflow boxes pin to the kit they were built on and
  are not force-rebuilt** when a new kit version appears — so adding a provider/workflow later does
  not disturb running workflows.

### 3. Per-workflow box identity (the "label")

A box is tagged by **(workflowId, nodeId?, computeTargetId, recipeFingerprint, kitVersion)**:
- `recipeFingerprint` = hash of the effective wrapped Dockerfile (or the ref string).
- Including `workflowId` (+ `nodeId` for overrides) gives **per-workflow ownership** — no two
  workflows ever share a built image, even with identical recipes.
- Including `computeTargetId`/host keeps the same recipe on two hosts tracked separately.
- Including `kitVersion` lets a box stay valid on its kit and rebuild cleanly after a kit bump.

### 4. Managed build lifecycle (owned by the worker)

Build state per box: `none → pending → building → ready | failed`.

- **Triggers:** workflow/step image created or its fingerprint changes → `pending`; a manual
  **Rebuild** endpoint forces `pending` (covers re-pushed mutable `:latest`).
- **Executor:** a background loop in the **worker process** (it holds the Docker connection). It
  **claims** a pending box (atomic DB update, so replicas don't double-build), **leases** it (a
  timeout + heartbeat so a crashed builder doesn't wedge it), **ensures the runner kit** on the host,
  builds the box, and writes `ready` (+ image ref) or `failed` (+ captured build log).
- **Stale-build guard:** commit the result only if the box's fingerprint is still current; otherwise
  discard the now-stale image.

### 5. Run-gating (use / wait / fail-fast)

At run provisioning, after resolving the Compute Target (connection) + the workflow/step image:

| Box state (current fingerprint) | Run behavior |
|---|---|
| `ready` | provision immediately from the box image (fast) |
| `pending` / `building` | throw a **retryable** error → Conductor backs off and retries → resumes when `ready`; emits `step.log` "image building — waiting" |
| `failed` | throw a **terminal** error carrying the build log → run fails fast with the real reason |
| missing at provision (TOCTOU / pruned) | treat as not-ready → re-enqueue build + wait |

In-flight runs already on an older box finish on it; only new provisions consult the new state.

### 6. Cleanup

- On rebuild to a new fingerprint, or on **workflow/step deletion**, remove **that workflow's** old
  box images on its host. Per-workflow ownership means **no cross-workflow refcount** is needed.
- Don't remove an image backing a **live** container; a dangling/age sweep (extending the existing
  sandbox reaper) reclaims anything missed.
- Note (today): a `jm-built` pile already accumulates (~8 images / ~4.8 GB observed) — this step
  fixes that.

### 7. Provider = runtime toggle (Spec A.2)

The chosen provider (`claude`/`opencode`/…) is **not** part of image identity — every box already has
all engines from the kit. The workflow/step toggles the provider; the matching API key arrives as an
env var. So switching providers never rebuilds a box.

### 8. Cloud (ECS/EKS) vs local

- **Local / single VM:** Compute Target connection = local socket; kit built-from-source or pulled;
  boxes built on that host.
- **Cloud (ECS/EKS/…):** Compute Target connection = **remote** `tcp://host:2376` (private network);
  the **kit is a prebuilt image the daemon pulls from a registry (e.g. ECR)** — no source-shipping,
  no npm-on-daemon. Workflow boxes build on that daemon `FROM`/`COPY --from` the pulled kit.
  Build-from-source remains the local/dev fallback.

## Data model (indicative)

- `jm_flows` (workflow): add image config on the **defaults** blob (`defaults.image`); per-node
  `node.image` in the flow JSON (with a load-time alias if needed). Compute Target's `config.image`
  removed (migration; existing values can map to a workflow default during transition).
- New table `jm_built_boxes` (or `jm_workflow_images`): `(id, workflow_id, node_id NULL,
  compute_target_id, fingerprint, kit_version, image_ref, state, error, built_at, lease_until,
  build_owner)`. Drives lifecycle, gating, and cleanup.

## Run resolution (two lookups)

```
run start →
  resolve Compute Target  → connection (where)
  resolve image           → node.image ?? workflow.defaults.image ?? (plain kit)
  fingerprint(image, host, kitVersion, workflowId[, nodeId])
  ensure box ready on host (build if needed; gate per §5)
  provision container + volume from the box image
  run step → provider toggle + API-key env (§7)
```

## Edge cases & guards (re-homed)

- **Concurrency:** atomic claim + lease/timeout reclaim; stale-fingerprint discard on commit.
- **Build failures:** classify transient (npm blip / daemon down → bounded auto-retry) vs terminal
  (bad Dockerfile → `failed`); **capture the build log** into `error` (not just "failed").
- **Run-gating races:** TOCTOU missing-image → re-enqueue+wait; long build vs retry budget →
  retry/backoff tuned (or pause); thundering herd when many waiting runs start at once.
- **Config traps:** image-ref workers must `docker pull` the ref (createContainer won't auto-pull;
  failure → `failed`); mutable `:latest` only refreshes on **Rebuild**; switching a Compute Target
  type docker→local clears image state for affected workflows; **post-build smoke test** (selftest +
  `git --version`) so a box that built but lacks tools is caught as `failed`, not at run time.
- **Deployment:** air-gapped daemon can't reach npm for a source build → prefer registry-pull kit;
  **build-time secrets** for a **private base image** belong to the workflow (a workflow-level build
  credential) — open question to finalize.
- **Lifecycle/migration:** backfill — existing docker Compute Targets that carried `config.image` map
  that image to the using workflow's default during migration; deleting a workflow mid-build abandons
  the build and cleans images after in-flight runs finish; a `failed` default-path box surfaces
  prominently in the UI.

## UI

- New **Image tab** in workflow config (default image) and on each step (override).
- Box **state badge** (Building… / Ready / Failed + the build error) and a **Rebuild** button,
  surfaced per workflow (and per overriding step).

## Verification

1. One CT + Workflow A (Claude) + Workflow B (OpenCode): kit built/pulled once; A and B get separate
   boxes; both run; switching providers needs no rebuild.
2. Start a run while a box is `building` → it waits and completes; never "image missing".
3. Break a Dockerfile + Rebuild → `failed` with the real log; a run fails fast citing it.
4. Edit Workflow A's image → A rebuilds; **Workflow B untouched**; old A box reclaimed; in-flight A
   runs finish on the old box.
5. Delete a workflow → its boxes removed; others untouched.
6. Cloud: remote `tcp://` CT + registry-pulled kit → (1)–(2) pass with no source-shipping.
7. `local` Compute Target still runs in-process (regression).

---

## Dry-run refinements (v2)

Decisions from a dry-run of "create compute target + workflows (same and different providers)":

1. **One "Run target" tab, fields driven by the target type.** The workflow config has a single
   tab where you pick the Compute Target; the sub-fields then depend on its **type** — a **Docker**
   target shows the **image fields** (Dockerfile or base-image ref) + network/resources; a **Local**
   target shows **no image fields**. Same conditional on the per-step override tab. This *replaces*
   the separate "Image tab" idea and **removes the "Local silently ignores the image" trap** by
   construction. **Switching a workflow's target to a non-Docker type clears the image config** (we
   don't keep it around).

2. **No custom image → use the shared kit directly (no private box).** "Each workflow gets its own
   box" applies only to workflows that set a **custom image**. An empty image runs in the shared kit
   (no build, instant). Each run still gets its own fresh container + volume regardless.

3. **Ref *and* Dockerfile both always get the kit grafted on — the kit is the mandatory base.** A
   base-image **ref** is treated as "the base the user wants" (≈ a one-line `FROM <ref>`) and goes
   through the **same kit-graft build** as a Dockerfile. So the runner + git + providers are
   *always* present at the current version — **no trust, no "validate the ref", no stale-ref
   problem.** Caveat: the chosen base must be **glibc-compatible** (the bundle's `node`); warn on
   musl/alpine bases. (This supersedes §3's `ref → used as-is` wording.)

4. **Box identity is per (workflow × compute target).** Boxes live on a specific host, so the count
   is workflows × the hosts they run on × distinct recipes. **Eager build pre-warms only the
   workflow's default Compute Target;** running on a *different* host builds **lazily on first use**
   (the run waits via §5 gating — it does not fail). Normal, expected behavior; only relevant with
   multiple Docker hosts.

5. **Cleanup relies on Docker's in-use protection — no heavy active-run tracking.** Docker refuses
   to delete an image a container is using, and a run keeps one container alive for its whole life,
   so cleanup just **tries** to remove old boxes and **skips** in-use ones (Docker says no), removing
   them on a later pass once the run finishes. (Downgrades the earlier "track active run snapshots"
   requirement.) Revisit only **if** we ever tear down idle containers during long pauses.

6. **Per-workflow isolation is cheaper than it looks.** Identical recipes across workflows build
   **separate tags** but **share Docker layers**, so disk duplication is small, and per-workflow
   cleanup is **layer-safe** (Docker won't drop layers another box still uses).

7. **Manual "Clean up images" action on the Compute Target** (todo #23): an admin can, on demand,
   prune unused/old boxes + dangling images on that host (skipping in-use ones), with a
   dry-run/confirm. Complements the automatic per-workflow cleanup.

8. **Secrets reach the box per-step, where the step runs (verified).** AI provider keys are
   forwarded into the container as exec env (confirmed end-to-end). Remote/API steps (tickets, PRs,
   Slack) keep their secrets in the **worker process** (least privilege — the box never sees them).
   ⚠️ **Gap (todo #24):** the **git clone token is not yet carried into the box** → private-repo
   clone works on Local but fails on Docker. Fix **provider-agnostically**: build the authed clone
   URL via the git provider (GitHub's `buildCloneUrl`; GitLab its own — **no host hardcoding in the
   runner**), pass it into the box, redact `//user:secret@` from logs, and optionally reset the
   box's remote to the clean URL so the token isn't left in `.git/config`.

---

## Dry-run refinements (v3 — corrections)

1. **Git auth in the box = clone with a provider-built token-in-URL (corrects v2 §8 / todo #24).**
   The AI agent runs its **own `git commit`/`git push`** inside the box, so per-command URL rewriting
   isn't enough. Simplest correct fix (and what local already does): build the **authed clone URL**
   on the worker via the **git provider** (GitHub `buildCloneUrl`; others their own — *no host
   hardcoding in the runner*) and clone with it. Git saves it as `remote.origin.url`, so the token
   persists in the box's `.git/config` → the agent's later `commit` (no network) and `push` (reuses
   origin) **both authenticate with no extra setup**. The runner stays generic and **redacts**
   `//user:secret@` in logs. (Drops the earlier `-c http.extraheader` idea, which wouldn't cover the
   agent's push.) Accepted caveat (= local behavior): the token sits in the box's `.git/config`;
   future hardening could strip the remote after push.

2. **Per-step image override: containers have their own workspace for now (todo #25).** When steps
   in a run use **different** images, each runs in its **own** container with its **own** `/workspace`
   — an override step does **not** inherit the cloned repo. (The common case — all steps same image —
   still shares one box/workspace.) Sharing one workspace volume across a run's containers is a
   **future** enhancement, not now.

3. **Warn before deleting a Compute Target that's in use (todo #26).** Deleting a CT that workflows
   reference makes their **new** runs fail with a clear "compute target not found" (in-flight runs
   unaffected). The delete path should **check usage and show a confirmation warning** (not a hard
   block).

4. **Migration: N/A.** No existing compute-target `image` data to migrate (greenfield) — workflows
   simply start imageless (use the shared kit) until an image is set.

---

## Dry-run round 2 (validated + refinements)

**Validated (no change):**
- **Concurrent runs of the same workflow, box not yet built:** both runs wait (run-gating); the build
  poller's atomic claim + lease ensures **one** build, not a race; per-run containers/volumes keep the
  runs isolated.
- **Multi-provider within one workflow** (e.g. step 1 Claude, step 3 OpenCode): same box (kit has all
  engines), each step resolves its own provider's key. Works, given both are registered in
  `PROVIDER_CATALOG` with their key slots.

**Refinements:**

1. **Cross-host repos → use multiple clone steps (no limitation).** A single clone step has one
   provider/token, so it can't auth GitHub + GitLab together. The intended pattern is **one clone
   step per provider** — step 1 (GitHub provider/token) and step 2 (GitLab provider/token) both clone
   into the **same shared `/workspace`**. Per-step provider + per-step secret resolution + the
   provider-built authed URL (#24) make this work with no special code. (Per-repo-by-host auth in a
   single step is an optional future nicety, not needed.)

2. **Long pauses → keep idle boxes alive (now); tear-down+reattach later (todo #27).** A run paused on
   a human task / webhook keeps its container alive for the pause (simplest, correct). Future
   optimization for many simultaneous long pauses: tear down the idle container but keep the
   workspace volume, re-attach on resume. (This is the one case where cleanup must respect an
   active-but-container-less run.)

3. **Infra errors are retryable + clearly worded.** Distinguish **transient infra** failures —
   "can't reach Docker at `<host>`", daemon down, network blip, "no worker available to build" —
   which are **retryable (backoff)** and must NOT mark a box permanently `failed`, from **terminal
   build-content** failures (broken Dockerfile) which fail fast. Messages must make clear whether the
   problem is **infra** or **the workflow's image**.

---

## Deployment dry-run (Docker Compose & AWS ECS)

**The key distinction:** two different Dockers — (1) the one running **Journeyman itself** (compose/ECS
runs api/worker/web as containers), and (2) the one running **job boxes** (what a **Compute Target**
points at). The Compute Target's connection (an address) is what tells Journeyman where jobs run.

### Compute-target choices (simplified)

- **Type `local`** — jobs run **in-process inside the worker**. **Zero infra** (no Docker, no socket,
  no address). No isolation, no custom image. The simplest deploy on any platform. **Kept.**
- **Type `docker`** — jobs run in a box on a Docker daemon at an **address** (todo #28: a single
  "Docker address" field; the local-socket/remote dropdown is removed — **always a remote address**).

So **you do not configure anything Docker-specific in compose/ECS** to point at job-Docker — the
**Compute Target address** handles it. The worker container only needs **network access** to that
address.

### Compose

- Use a **Local** compute target → nothing extra. Or a **Docker** compute target → point it at a
  Docker address. If you want it to use the *same host's* Docker, expose Docker on TCP and use
  `tcp://host.docker.internal:2375` (note: `localhost` from inside the worker container is the
  container, not the host).

### AWS ECS

- Stack runs as ECS tasks (api/worker/web). **"Deploy on ECS" does NOT mean each job becomes an ECS
  task** — the `ecs` compute type is *planned*, not built. Jobs run **Local** (in the worker task)
  or in a **Docker box on a daemon you point at**.
- For Docker boxes: a **remote Docker daemon** on the **private subnet** (`tcp://docker-host:2376`),
  the **kit prebuilt in ECR** (the daemon pulls it; needs ECR auth), and per-workflow boxes built on
  that daemon.

### Deployment rules folded in

1. **Compute-target address is the whole story** — no compose/ECS-level Docker config needed (the
   removed local-socket option was the only thing that needed a socket mount).
2. **Local type = zero-infra fallback** on any platform.
3. **No native ECS/K8s per-run** yet — jobs run Local or on a Docker daemon you provide.
4. **Remote Docker over plain TCP = private network only** until a TLS-cert field exists (todo #29).
5. **One shared Docker host = disk + single point of failure.** Mitigate with **cleanup** (#23) and
   by **adding more compute targets** (more Docker hosts) and spreading workflows across them — a
   compute target is just an address, so scaling = add addresses.
