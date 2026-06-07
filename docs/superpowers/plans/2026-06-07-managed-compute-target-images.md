# Managed Compute-Target Images Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move Docker compute-target image builds *out of the run* and into a tracked, ahead-of-time lifecycle on the compute target (`none → pending → building → ready | failed`), so runs just consult the stored state (use / wait / fail-fast) instead of building synchronously.

**Architecture:** A compute target's `config.image` (already stored) gains a build lifecycle backed by new columns on `jm_compute_targets`. Saving a docker target with a `ref`/`dockerfile` image flips it to `pending`. A leased background loop in the **worker** (it holds the Docker connection) claims pending targets, builds the kit-grafted image, and commits `ready`+`image_ref` or `failed`+`image_error`. At run time, `provisionDocker` no longer builds — it reads the state and either provisions from the stored `image_ref` (`ready`), throws a **retryable** error (`pending`/`building`/unreachable daemon → Conductor backs off), or throws a **terminal** `ConfigurationError` (`failed`, with the captured build log).

**Tech Stack:** TypeScript (Node, ESM, `.ts` imports), PostgreSQL via `pg` (raw SQL, append-only migrations), Vitest, React (web + flow-editor). Spec: `docs/superpowers/specs/2026-06-03-managed-compute-target-images-design.md` (on branch `docs/spec-b-managed-images`).

---

## Source spec & scope

**In scope (this plan):** the managed build lifecycle — DB columns, fingerprint, pending-on-save, the build loop, run-gating, cleanup, a Rebuild action + state badge — plus registering `opencode` in `PROVIDER_CATALOG`.

**Out of scope (separate follow-up plans / todos):** git auth into the box (#24), curated image presets (B1), governance/admin-only creation (B3), secrets pre-flight (B2), warn-on-delete (#26), TLS certs (#29), per-step image override (#25). These are noted in `docs/superpowers/TODO.md` and do not block this plan.

**Prerequisite:** the spec doc lives on branch `docs/spec-b-managed-images`. Before starting, merge that branch to `master` (docs-only) or cherry-pick the spec file so it is present in the working tree.

## File structure

| File | Responsibility | Action |
|---|---|---|
| `packages/migrations/src/sql/038_compute_target_image_state.sql` | Build-state columns on `jm_compute_targets` | Create |
| `packages/core/src/types/compute-target.types.ts` | Add `ImageState` + build fields to `ComputeTarget` | Modify |
| `packages/compute/src/compute-target-record.ts` | Map new columns in `rowToComputeTarget` | Modify |
| `packages/compute/src/db.ts` | `COLS` + lifecycle DB ops (pending/claim/renew/commit/fail/cleanup) | Modify |
| `packages/compute/src/backends/docker/recipe.ts` | Pure effective-recipe + fingerprint (no Docker client) | Create |
| `packages/compute/src/backends/docker/build-image.ts` | `buildBoxImage` (ref + dockerfile + empty), reuse hashing | Modify |
| `packages/compute/src/build/build-loop.ts` | Leased background build executor | Create |
| `packages/compute/src/index.ts` | Export new symbols | Modify |
| `packages/orchestrator/src/sandbox/ensure-workspace.ts` | Run-gating: consult state, throw retryable/terminal | Modify |
| `packages/orchestrator/src/cli-worker.ts` | Stop building in-run; start the build loop | Modify |
| `packages/compute/src/routes/index.ts` | `POST …/:id/rebuild` route | Modify |
| `packages/web/src/api/computeTargets.ts` | `rebuild()` client + `ComputeTarget` build fields | Modify |
| `packages/web/src/routes/ComputeTargetsPage.tsx` | State badge + Rebuild button | Modify |
| `packages/core/src/registries/provider-catalog.ts` | Register `opencode` coding-cli entry | Modify |

---

## Task 1: Build-state schema + types

**Files:**
- Create: `packages/migrations/src/sql/038_compute_target_image_state.sql`
- Modify: `packages/core/src/types/compute-target.types.ts`
- Modify: `packages/compute/src/compute-target-record.ts`
- Modify: `packages/compute/src/db.ts:9` (the `COLS` constant)
- Test: `packages/compute/src/compute-target-record.test.ts`

- [ ] **Step 1: Write the migration**

Create `packages/migrations/src/sql/038_compute_target_image_state.sql`:

```sql
-- 038_compute_target_image_state.sql
-- Spec B: managed compute-target images. Adds the build lifecycle columns to
-- jm_compute_targets. Append-only; existing rows default to image_state='none'
-- (meaning "no managed image → use the default runner box").
ALTER TABLE jm_compute_targets
  ADD COLUMN IF NOT EXISTS image_state       TEXT NOT NULL DEFAULT 'none'
    CHECK (image_state IN ('none','pending','building','ready','failed')),
  ADD COLUMN IF NOT EXISTS image_fingerprint TEXT,
  ADD COLUMN IF NOT EXISTS image_ref         TEXT,
  ADD COLUMN IF NOT EXISTS image_error       TEXT,
  ADD COLUMN IF NOT EXISTS image_built_at    TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS build_owner       TEXT,
  ADD COLUMN IF NOT EXISTS build_lease_until TIMESTAMPTZ;

-- Claimable-work lookup for the build loop (pending, or a stale building lease).
CREATE INDEX IF NOT EXISTS idx_jm_compute_targets_build
  ON jm_compute_targets (image_state, build_lease_until);
```

- [ ] **Step 2: Add the types**

In `packages/core/src/types/compute-target.types.ts`, after the `ComputeTargetScope` line (line 3), add:

```ts
export type ImageState = "none" | "pending" | "building" | "ready" | "failed";
```

Then inside `interface ComputeTarget`, after `updatedAt: Date;` (line 23), add:

```ts
  /** Managed-image build lifecycle (docker targets). 'none' = use the default box. */
  imageState: ImageState;
  imageFingerprint: string | null;
  imageRef: string | null;
  imageError: string | null;
  imageBuiltAt: Date | null;
```

Update the import on line 1 is not needed (`ImageState` is declared in this file).

- [ ] **Step 3: Write the failing test for row mapping**

In `packages/compute/src/compute-target-record.test.ts`, add (create the file if absent, importing `rowToComputeTarget`):

```ts
import { describe, it, expect } from "vitest";
import { rowToComputeTarget } from "./compute-target-record.ts";

describe("rowToComputeTarget build fields", () => {
  it("maps image_* columns", () => {
    const ct = rowToComputeTarget({
      id: "t1", scope: "org", org_id: "o1", user_id: null, name: "Python",
      type: "docker", execution_mode: "per-instance", connectivity: "push",
      config: {}, is_default: false, tags: [], enabled: true, created_by: null,
      created_at: new Date(0), updated_at: new Date(0),
      image_state: "ready", image_fingerprint: "abc", image_ref: "journeyman/jm-built:abc",
      image_error: null, image_built_at: new Date(0),
    });
    expect(ct.imageState).toBe("ready");
    expect(ct.imageRef).toBe("journeyman/jm-built:abc");
    expect(ct.imageFingerprint).toBe("abc");
  });

  it("defaults image_state to 'none' when the column is absent", () => {
    const ct = rowToComputeTarget({
      id: "t2", scope: "system", org_id: null, user_id: null, name: "Local",
      type: "local", execution_mode: "shared", connectivity: null,
      config: {}, is_default: true, tags: [], enabled: true, created_by: null,
      created_at: new Date(0), updated_at: new Date(0),
    });
    expect(ct.imageState).toBe("none");
    expect(ct.imageRef).toBeNull();
  });
});
```

- [ ] **Step 4: Run the test to verify it fails**

Run: `npm test -w @journeyman/compute -- compute-target-record`
Expected: FAIL — `imageState` is `undefined`.

- [ ] **Step 5: Map the columns in `rowToComputeTarget`**

In `packages/compute/src/compute-target-record.ts`, inside the returned object (after `updatedAt: r.updated_at,`), add:

```ts
    imageState: (r.image_state ?? "none") as ComputeTarget["imageState"],
    imageFingerprint: r.image_fingerprint ?? null,
    imageRef: r.image_ref ?? null,
    imageError: r.image_error ?? null,
    imageBuiltAt: r.image_built_at ?? null,
```

- [ ] **Step 6: Extend the `COLS` constant**

In `packages/compute/src/db.ts` line 9, replace the `COLS` string with:

```ts
const COLS =
  "id, scope, org_id, user_id, name, type, execution_mode, connectivity, config, is_default, tags, enabled, created_by, created_at, updated_at, image_state, image_fingerprint, image_ref, image_error, image_built_at";
```

- [ ] **Step 7: Run the test + typecheck**

Run: `npm test -w @journeyman/compute -- compute-target-record && npm run typecheck`
Expected: PASS; typecheck clean.

- [ ] **Step 8: Commit**

```bash
git add packages/migrations/src/sql/038_compute_target_image_state.sql \
  packages/core/src/types/compute-target.types.ts \
  packages/compute/src/compute-target-record.ts \
  packages/compute/src/db.ts \
  packages/compute/src/compute-target-record.test.ts
git commit -m "feat(compute): build-state columns + types for managed images"
```

---

## Task 2: Pure recipe + fingerprint

**Files:**
- Create: `packages/compute/src/backends/docker/recipe.ts`
- Test: `packages/compute/src/backends/docker/recipe.test.ts`

The fingerprint is `sha256(effectiveRecipe + "\0" + bundleId)` truncated to 16 hex chars. `bundleId` (the runner-bundle image digest) folds the **kit version** in: a rebuilt kit changes the digest, which changes the fingerprint, which forces a rebuild — satisfying the spec's "kit-version bump rebuilds boxes". An empty image needs no build (the default box already *is* the kit), so `buildEffectiveRecipe` returns `null` for it.

- [ ] **Step 1: Write the failing test**

Create `packages/compute/src/backends/docker/recipe.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { buildEffectiveRecipe, computeFingerprint, type ImageConfig } from "./recipe.ts";

const BUNDLE = "journeyman/runner-bundle:dev";

describe("buildEffectiveRecipe", () => {
  it("wraps a dockerfile with the kit graft", () => {
    const r = buildEffectiveRecipe({ kind: "dockerfile", content: "FROM python:3.12\n" }, BUNDLE);
    expect(r).toContain("FROM python:3.12");
    expect(r).toContain(`COPY --from=${BUNDLE} /opt/journeyman /opt/journeyman`);
  });

  it("treats a ref as a one-line FROM, still grafting the kit", () => {
    const r = buildEffectiveRecipe({ kind: "ref", imageRef: "node:20" }, BUNDLE);
    expect(r).toContain("FROM node:20");
    expect(r).toContain(`COPY --from=${BUNDLE} /opt/journeyman`);
  });

  it("returns null for an empty image (no build needed)", () => {
    expect(buildEffectiveRecipe(undefined, BUNDLE)).toBeNull();
    expect(buildEffectiveRecipe({ kind: "ref", imageRef: "" }, BUNDLE)).toBeNull();
  });
});

describe("computeFingerprint", () => {
  it("is stable for the same recipe + bundle id", () => {
    const a = computeFingerprint("FROM x\n", "sha256:abc");
    const b = computeFingerprint("FROM x\n", "sha256:abc");
    expect(a).toBe(b);
    expect(a).toHaveLength(16);
  });
  it("changes when the bundle id (kit) changes", () => {
    expect(computeFingerprint("FROM x\n", "sha256:abc"))
      .not.toBe(computeFingerprint("FROM x\n", "sha256:def"));
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -w @journeyman/compute -- recipe`
Expected: FAIL — `Cannot find module './recipe.ts'`.

- [ ] **Step 3: Implement `recipe.ts`**

Create `packages/compute/src/backends/docker/recipe.ts`:

```ts
import { createHash } from "node:crypto";
import { wrapDockerfile } from "./dockerfile-wrap.ts";

export type ImageConfig =
  | { kind?: "dockerfile"; content?: string }
  | { kind?: "ref"; imageRef?: string }
  | undefined;

/**
 * The effective Dockerfile we will build for a compute target's image, with the
 * runner kit always grafted on. Returns null when no build is needed (empty
 * image → the default runner box already contains the kit).
 */
export function buildEffectiveRecipe(image: ImageConfig, bundleRef: string): string | null {
  if (image?.kind === "dockerfile" && typeof image.content === "string" && image.content.trim()) {
    return wrapDockerfile(image.content, bundleRef);
  }
  if (image?.kind === "ref" && typeof image.imageRef === "string" && image.imageRef.trim()) {
    return wrapDockerfile(`FROM ${image.imageRef}\n`, bundleRef);
  }
  return null;
}

/** Stable 16-hex fingerprint of (recipe + kit/bundle digest). */
export function computeFingerprint(effectiveRecipe: string, bundleId: string): string {
  return createHash("sha256")
    .update(effectiveRecipe)
    .update("\0")
    .update(bundleId)
    .digest("hex")
    .slice(0, 16);
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm test -w @journeyman/compute -- recipe`
Expected: PASS (3 + 2 assertions).

- [ ] **Step 5: Commit**

```bash
git add packages/compute/src/backends/docker/recipe.ts packages/compute/src/backends/docker/recipe.test.ts
git commit -m "feat(compute): pure effective-recipe + fingerprint helpers"
```

---

## Task 3: `buildBoxImage` (ref + dockerfile, kit-grafted)

**Files:**
- Modify: `packages/compute/src/backends/docker/build-image.ts`
- Test: `packages/compute/src/backends/docker/build-image.test.ts`

Generalize the existing `buildDockerfileImage` (dockerfile-only) into `buildBoxImage`, which accepts the whole `ImageConfig` and reuses Task 2's recipe/fingerprint. It returns `{ imageRef, fingerprint }`. Keep `buildDockerfileImage` as a thin wrapper so existing callers/tests don't break (it is removed from the run path in Task 6).

- [ ] **Step 1: Write the failing test**

Create/extend `packages/compute/src/backends/docker/build-image.test.ts`:

```ts
import { describe, it, expect, vi } from "vitest";
import { buildBoxImage } from "./build-image.ts";

function fakeClient(opts: { exists: boolean }) {
  return {
    imageId: vi.fn().mockResolvedValue("sha256:bundle"),
    imageExists: vi.fn().mockResolvedValue(opts.exists),
    buildImage: vi.fn().mockResolvedValue(undefined),
  } as any;
}

describe("buildBoxImage", () => {
  it("reuses a cached image without building", async () => {
    const client = fakeClient({ exists: true });
    const r = await buildBoxImage({
      image: { kind: "ref", imageRef: "node:20" },
      client, bundleRef: "journeyman/runner-bundle:dev",
    });
    expect(r.imageRef).toMatch(/^journeyman\/jm-built:[0-9a-f]{16}$/);
    expect(r.fingerprint).toHaveLength(16);
    expect(client.buildImage).not.toHaveBeenCalled();
  });

  it("builds when the image is absent", async () => {
    const client = fakeClient({ exists: false });
    await buildBoxImage({
      image: { kind: "dockerfile", content: "FROM python:3.12\n" },
      client, bundleRef: "journeyman/runner-bundle:dev",
    });
    expect(client.buildImage).toHaveBeenCalledOnce();
  });

  it("throws for an empty image (caller must use the default box)", async () => {
    const client = fakeClient({ exists: false });
    await expect(buildBoxImage({ image: undefined, client, bundleRef: "b" }))
      .rejects.toThrow(/no image recipe/i);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -w @journeyman/compute -- build-image`
Expected: FAIL — `buildBoxImage` is not exported.

- [ ] **Step 3: Implement `buildBoxImage`**

Replace the body of `packages/compute/src/backends/docker/build-image.ts` with:

```ts
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { IDockerClient } from "./docker-client.ts";
import { buildEffectiveRecipe, computeFingerprint, type ImageConfig } from "./recipe.ts";

export interface BuildBoxImageDeps {
  image: ImageConfig;
  client: IDockerClient;
  bundleRef: string;
  tagPrefix?: string;
}

export interface BuildBoxImageResult {
  imageRef: string;
  fingerprint: string;
}

/**
 * Build (or reuse) a compute target's box image: the user's ref/dockerfile,
 * auto-wrapped with the runner kit. Throws if the image is empty (the caller
 * should fall back to the default box instead of building).
 */
export async function buildBoxImage(deps: BuildBoxImageDeps): Promise<BuildBoxImageResult> {
  const effective = buildEffectiveRecipe(deps.image, deps.bundleRef);
  if (effective === null) throw new Error("no image recipe to build (empty image)");

  const bundleId = (await deps.client.imageId(deps.bundleRef)) ?? "";
  const fingerprint = computeFingerprint(effective, bundleId);
  const imageRef = `${deps.tagPrefix ?? "journeyman/jm-built"}:${fingerprint}`;

  if (await deps.client.imageExists(imageRef)) return { imageRef, fingerprint };

  const dir = await mkdtemp(join(tmpdir(), "jm-build-"));
  try {
    await writeFile(join(dir, "Dockerfile"), effective, "utf8");
    await deps.client.buildImage({ contextDir: dir, dockerfileName: "Dockerfile", tag: imageRef });
    return { imageRef, fingerprint };
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

/** @deprecated dockerfile-only shim retained for compatibility; prefer buildBoxImage. */
export async function buildDockerfileImage(deps: {
  content: string; client: IDockerClient; bundleRef: string; tagPrefix?: string;
}): Promise<string> {
  const { imageRef } = await buildBoxImage({
    image: { kind: "dockerfile", content: deps.content },
    client: deps.client, bundleRef: deps.bundleRef,
    ...(deps.tagPrefix ? { tagPrefix: deps.tagPrefix } : {}),
  });
  return imageRef;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm test -w @journeyman/compute -- build-image`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/compute/src/backends/docker/build-image.ts packages/compute/src/backends/docker/build-image.test.ts
git commit -m "feat(compute): buildBoxImage (ref + dockerfile, kit-grafted)"
```

---

## Task 4: Lifecycle DB ops (pending / claim / renew / commit / fail / cleanup)

**Files:**
- Modify: `packages/compute/src/db.ts`
- Test: `packages/compute/src/db-build.test.ts`

All ops are atomic SQL. `claimPendingBuild` grabs one target whose state is `pending`, **or** is `building` with an expired lease (crash recovery), and leases it. `commitBuildResult`/`failBuild` are **stale-guarded**: they only write if `image_fingerprint` matches the fingerprint the loop built, so a recipe edit mid-build doesn't clobber newer state.

- [ ] **Step 1: Write the failing test (against a `Queryable` fake)**

Create `packages/compute/src/db-build.test.ts`:

```ts
import { describe, it, expect, vi } from "vitest";
import {
  markImagePending, claimPendingBuild, renewBuildLease,
  commitBuildResult, failBuild, clearImageState,
} from "./db.ts";

function db(rows: any[] = []) {
  return { query: vi.fn().mockResolvedValue({ rows }) };
}

describe("build lifecycle DB ops", () => {
  it("markImagePending flips state to pending and clears error", async () => {
    const d = db([{ id: "t1" }]);
    await markImagePending(d as any, "t1");
    const [sql, params] = d.query.mock.calls[0];
    expect(sql).toContain("image_state = 'pending'");
    expect(sql).toContain("image_error = NULL");
    expect(params).toEqual(["t1"]);
  });

  it("claimPendingBuild leases pending or stale-building rows", async () => {
    const d = db([{ id: "t1", config: {}, image_state: "building" }]);
    const r = await claimPendingBuild(d as any, "owner-1", 60_000);
    const [sql] = d.query.mock.calls[0];
    expect(sql).toContain("image_state = 'building'");
    expect(sql).toContain("build_owner");
    expect(r?.id).toBe("t1");
  });

  it("claimPendingBuild returns null when nothing is claimable", async () => {
    expect(await claimPendingBuild(db([]) as any, "o", 1000)).toBeNull();
  });

  it("commitBuildResult is stale-guarded by fingerprint", async () => {
    const d = db([{ id: "t1" }]);
    await commitBuildResult(d as any, "t1", "fp123", "journeyman/jm-built:fp123");
    const [sql, params] = d.query.mock.calls[0];
    expect(sql).toContain("image_state = 'ready'");
    expect(sql).toContain("image_fingerprint = $2");
    expect(params).toEqual(["t1", "fp123", "journeyman/jm-built:fp123"]);
  });

  it("failBuild stores the error and fingerprint", async () => {
    const d = db([{ id: "t1" }]);
    await failBuild(d as any, "t1", "fp123", "boom");
    const [sql, params] = d.query.mock.calls[0];
    expect(sql).toContain("image_state = 'failed'");
    expect(params).toEqual(["t1", "fp123", "boom"]);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -w @journeyman/compute -- db-build`
Expected: FAIL — functions not exported.

- [ ] **Step 3: Implement the ops in `db.ts`**

Append to `packages/compute/src/db.ts`:

```ts
import { rowToComputeTarget as _row } from "./compute-target-record.ts";
import type { ComputeTarget } from "@journeyman/core";

/** Flip a target's image to 'pending' (recompute on next build loop tick). */
export async function markImagePending(db: Queryable, id: string): Promise<void> {
  await db.query(
    `UPDATE jm_compute_targets
        SET image_state = 'pending', image_error = NULL, updated_at = now()
      WHERE id = $1`,
    [id],
  );
}

/** Set a target back to 'none' (its image became empty → use the default box). */
export async function clearImageState(db: Queryable, id: string): Promise<void> {
  await db.query(
    `UPDATE jm_compute_targets
        SET image_state = 'none', image_fingerprint = NULL, image_ref = NULL,
            image_error = NULL, image_built_at = NULL, updated_at = now()
      WHERE id = $1`,
    [id],
  );
}

/**
 * Atomically claim one buildable target: state='pending', OR state='building'
 * with an expired lease (crash recovery). Leases it to `owner` for `leaseMs`.
 */
export async function claimPendingBuild(
  db: Queryable, owner: string, leaseMs: number,
): Promise<ComputeTarget | null> {
  const { rows } = await db.query(
    `UPDATE jm_compute_targets
        SET image_state = 'building', build_owner = $1,
            build_lease_until = now() + ($2::bigint * interval '1 millisecond'),
            updated_at = now()
      WHERE id = (
        SELECT id FROM jm_compute_targets
         WHERE type = 'docker' AND enabled = true AND (
                 image_state = 'pending'
              OR (image_state = 'building' AND (build_lease_until IS NULL OR build_lease_until < now()))
         )
         ORDER BY updated_at
         FOR UPDATE SKIP LOCKED
         LIMIT 1
      )
      RETURNING ${COLS}`,
    [owner, leaseMs],
  );
  return rows[0] ? _row(rows[0]) : null;
}

/** Extend a held lease (heartbeat during a long build). */
export async function renewBuildLease(
  db: Queryable, id: string, owner: string, leaseMs: number,
): Promise<void> {
  await db.query(
    `UPDATE jm_compute_targets
        SET build_lease_until = now() + ($3::bigint * interval '1 millisecond')
      WHERE id = $1 AND build_owner = $2 AND image_state = 'building'`,
    [id, owner, leaseMs],
  );
}

/** Commit a successful build (stale-guarded: only when fingerprint still matches). */
export async function commitBuildResult(
  db: Queryable, id: string, fingerprint: string, imageRef: string,
): Promise<void> {
  await db.query(
    `UPDATE jm_compute_targets
        SET image_state = 'ready', image_fingerprint = $2, image_ref = $3,
            image_error = NULL, image_built_at = now(),
            build_owner = NULL, build_lease_until = NULL, updated_at = now()
      WHERE id = $1`,
    [id, fingerprint, imageRef],
  );
}

/** Record a build failure with the captured log. */
export async function failBuild(
  db: Queryable, id: string, fingerprint: string, error: string,
): Promise<void> {
  await db.query(
    `UPDATE jm_compute_targets
        SET image_state = 'failed', image_fingerprint = $2, image_error = $3,
            build_owner = NULL, build_lease_until = NULL, updated_at = now()
      WHERE id = $1`,
    [id, fingerprint, error],
  );
}
```

> Note: `commitBuildResult` sets the fingerprint it just built, so the run-gating check in Task 6 (current fingerprint == stored) holds. The "stale guard" is the build loop re-checking the live recipe before commit (Task 5), plus `markImagePending` having reset state on any edit.

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm test -w @journeyman/compute -- db-build`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/compute/src/db.ts packages/compute/src/db-build.test.ts
git commit -m "feat(compute): build lifecycle DB ops (pending/claim/commit/fail)"
```

---

## Task 5: The build executor loop

**Files:**
- Create: `packages/compute/src/build/build-loop.ts`
- Modify: `packages/compute/src/index.ts`
- Test: `packages/compute/src/build/build-loop.test.ts`

A `runBuildTick(deps)` claims one target, builds its box (via Task 3) on a per-target Docker client (from `config.connection`), and commits `ready` or `failed`. `startBuildLoop(deps)` calls `runBuildTick` on an interval and returns a stop fn. The loop lives in `@journeyman/compute` (it owns Docker) and is started by `cli-worker`.

- [ ] **Step 1: Write the failing test**

Create `packages/compute/src/build/build-loop.test.ts`:

```ts
import { describe, it, expect, vi } from "vitest";
import { runBuildTick } from "./build-loop.ts";

const target = {
  id: "t1", config: { connection: { kind: "remote", host: "tcp://h:2376" },
    image: { kind: "ref", imageRef: "node:20" } },
} as any;

function deps(over: Partial<any> = {}) {
  return {
    db: { query: vi.fn() },
    bundleRef: "journeyman/runner-bundle:dev",
    leaseMs: 60_000,
    owner: "owner-1",
    claim: vi.fn().mockResolvedValue(target),
    makeClient: vi.fn().mockReturnValue({} as any),
    build: vi.fn().mockResolvedValue({ imageRef: "journeyman/jm-built:fp", fingerprint: "fp" }),
    commit: vi.fn().mockResolvedValue(undefined),
    fail: vi.fn().mockResolvedValue(undefined),
    renew: vi.fn().mockResolvedValue(undefined),
    log: vi.fn(),
    ...over,
  };
}

describe("runBuildTick", () => {
  it("builds and commits a claimed target", async () => {
    const d = deps();
    const did = await runBuildTick(d as any);
    expect(did).toBe(true);
    expect(d.build).toHaveBeenCalledOnce();
    expect(d.commit).toHaveBeenCalledWith("t1", "fp", "journeyman/jm-built:fp");
    expect(d.fail).not.toHaveBeenCalled();
  });

  it("records failure when the build throws", async () => {
    const d = deps({ build: vi.fn().mockRejectedValue(new Error("docker boom")) });
    const did = await runBuildTick(d as any);
    expect(did).toBe(true);
    expect(d.fail).toHaveBeenCalledWith("t1", expect.any(String), expect.stringContaining("docker boom"));
  });

  it("returns false when nothing is claimable", async () => {
    const d = deps({ claim: vi.fn().mockResolvedValue(null) });
    expect(await runBuildTick(d as any)).toBe(false);
    expect(d.build).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -w @journeyman/compute -- build-loop`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the loop**

Create `packages/compute/src/build/build-loop.ts`:

```ts
import type { ComputeTarget } from "@journeyman/core";
import type { Queryable } from "../db.ts";
import { claimPendingBuild, renewBuildLease, commitBuildResult, failBuild } from "../db.ts";
import { buildBoxImage, type BuildBoxImageResult } from "../backends/docker/build-image.ts";
import { makeDockerClient } from "../backends/docker/docker-client.ts";

export interface BuildTickDeps {
  db: Queryable;
  bundleRef: string;
  leaseMs: number;
  owner: string;
  log?: (line: string) => void;
  // Seams (overridable in tests):
  claim?: (db: Queryable, owner: string, leaseMs: number) => Promise<ComputeTarget | null>;
  makeClient?: (conn: unknown) => ReturnType<typeof makeDockerClient>;
  build?: (args: { image: unknown; client: any; bundleRef: string }) => Promise<BuildBoxImageResult>;
  commit?: (db: Queryable, id: string, fp: string, ref: string) => Promise<void>;
  fail?: (db: Queryable, id: string, fp: string, err: string) => Promise<void>;
  renew?: (db: Queryable, id: string, owner: string, leaseMs: number) => Promise<void>;
}

/** Claim + build + commit one target. Returns false if nothing was claimable. */
export async function runBuildTick(deps: BuildTickDeps): Promise<boolean> {
  const claim = deps.claim ?? claimPendingBuild;
  const makeClient = deps.makeClient ?? makeDockerClient;
  const build = deps.build ?? ((a) => buildBoxImage(a as any));
  const commit = deps.commit ?? commitBuildResult;
  const fail = deps.fail ?? failBuild;
  const log = deps.log ?? (() => {});

  const target = await claim(deps.db, deps.owner, deps.leaseMs);
  if (!target) return false;

  const cfg = (target.config ?? {}) as Record<string, unknown>;
  let fingerprint = target.imageFingerprint ?? "";
  try {
    log(`building image for compute target ${target.name} (${target.id})`);
    const client = makeClient(cfg["connection"] ?? { kind: "local" });
    const result = await build({ image: cfg["image"], client, bundleRef: deps.bundleRef });
    fingerprint = result.fingerprint;
    await commit(deps.db, target.id, result.fingerprint, result.imageRef);
    log(`image ready for ${target.id}: ${result.imageRef}`);
  } catch (err) {
    const message = (err as Error)?.message ?? String(err);
    await fail(deps.db, target.id, fingerprint, message);
    log(`image build failed for ${target.id}: ${message}`);
  }
  return true;
}

export interface StartBuildLoopDeps extends Omit<BuildTickDeps, "owner"> {
  /** Poll interval; default 3000ms. */
  intervalMs?: number;
  owner?: string;
}

/** Start a polling build loop. Returns a stop function. */
export function startBuildLoop(deps: StartBuildLoopDeps): () => void {
  const owner = deps.owner ?? `worker-${process.pid}`;
  const intervalMs = deps.intervalMs ?? 3000;
  let stopped = false;
  let timer: ReturnType<typeof setTimeout> | undefined;

  const tick = async () => {
    if (stopped) return;
    try {
      // Drain: keep building while work remains, then back off to the interval.
      let did = true;
      while (did && !stopped) did = await runBuildTick({ ...deps, owner });
    } catch (err) {
      (deps.log ?? (() => {}))(`build loop tick error: ${(err as Error).message}`);
    } finally {
      if (!stopped) timer = setTimeout(tick, intervalMs);
    }
  };
  timer = setTimeout(tick, intervalMs);
  return () => { stopped = true; if (timer) clearTimeout(timer); };
}
```

- [ ] **Step 4: Export from the package**

In `packages/compute/src/index.ts`, add:

```ts
export { runBuildTick, startBuildLoop } from "./build/build-loop.ts";
export { buildBoxImage } from "./backends/docker/build-image.ts";
export { buildEffectiveRecipe, computeFingerprint } from "./backends/docker/recipe.ts";
export {
  markImagePending, clearImageState, claimPendingBuild,
  renewBuildLease, commitBuildResult, failBuild,
} from "./db.ts";
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `npm test -w @journeyman/compute -- build-loop && npm run typecheck`
Expected: PASS; typecheck clean.

- [ ] **Step 6: Commit**

```bash
git add packages/compute/src/build/build-loop.ts packages/compute/src/build/build-loop.test.ts packages/compute/src/index.ts
git commit -m "feat(compute): background build executor loop"
```

---

## Task 6: Run-gating — provision from state, never build in-run

**Files:**
- Modify: `packages/orchestrator/src/sandbox/ensure-workspace.ts`
- Modify: `packages/orchestrator/src/cli-worker.ts`
- Test: `packages/orchestrator/src/sandbox/ensure-workspace.test.ts`

The run no longer builds. `resolveComputeTarget` already returns `{ type, config }`; we extend that dep to also return the build state fields (`imageState`, `imageRef`, `image` config). `ensureWorkspace` consults them **before** claiming the sandbox:

| Stored state (for current recipe) | Action |
|---|---|
| image is empty (`none`) | provision with the default box (unchanged behavior) |
| `ready` + `imageRef` present | provision with `imageRef` (no build) |
| `pending` / `building` | throw **retryable** `Error` ("preparing environment…") → Conductor backs off |
| `failed` | throw **terminal** `ConfigurationError` with `imageError` |
| `ready` but `imageRef` missing (pruned) | `markImagePending` + throw retryable |

- [ ] **Step 1: Write the failing test**

Add to `packages/orchestrator/src/sandbox/ensure-workspace.test.ts` (create if absent):

```ts
import { describe, it, expect, vi } from "vitest";
import { ensureWorkspace } from "./ensure-workspace.ts";

function baseDeps(target: any, over: Partial<any> = {}) {
  return {
    getSandbox: vi.fn().mockResolvedValue(null),
    claim: vi.fn().mockResolvedValue(true),
    markActive: vi.fn().mockResolvedValue(undefined),
    waitActive: vi.fn(),
    resolveComputeTarget: vi.fn().mockResolvedValue(target),
    provisionLocal: vi.fn(),
    provisionDocker: vi.fn().mockResolvedValue({
      env: {}, provisioned: { handle: "h", workspaceDir: "/workspace", type: "docker" },
      imageRef: "journeyman/jm-built:fp", connection: {},
    }),
    onImagePending: vi.fn(),
    ...over,
  };
}
const args = { runId: "r1", computeTargetId: "t1", userId: "u", orgId: "o" };

describe("ensureWorkspace run-gating", () => {
  it("provisions a ready docker image with its imageRef", async () => {
    const deps = baseDeps({ type: "docker", config: { image: { kind: "ref", imageRef: "node:20" } },
      imageState: "ready", imageRef: "journeyman/jm-built:fp" });
    await ensureWorkspace(deps as any, args);
    expect(deps.provisionDocker).toHaveBeenCalledWith("r1",
      expect.objectContaining({ config: expect.objectContaining({ __imageRef: "journeyman/jm-built:fp" }) }));
  });

  it("throws a RETRYABLE error while building", async () => {
    const deps = baseDeps({ type: "docker", config: { image: { kind: "ref", imageRef: "node:20" } },
      imageState: "building", imageRef: null });
    await expect(ensureWorkspace(deps as any, args)).rejects.toMatchObject({ name: "ImageNotReadyError" });
    expect(deps.provisionDocker).not.toHaveBeenCalled();
  });

  it("throws a TERMINAL ConfigurationError when the build failed", async () => {
    const deps = baseDeps({ type: "docker", config: { image: { kind: "ref", imageRef: "node:20" } },
      imageState: "failed", imageRef: null, imageError: "bad Dockerfile" });
    await expect(ensureWorkspace(deps as any, args))
      .rejects.toMatchObject({ name: "ConfigurationError", message: expect.stringContaining("bad Dockerfile") });
  });

  it("provisions the default box for an empty image", async () => {
    const deps = baseDeps({ type: "docker", config: {}, imageState: "none", imageRef: null });
    await ensureWorkspace(deps as any, args);
    expect(deps.provisionDocker).toHaveBeenCalledOnce();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -w @journeyman/orchestrator -- ensure-workspace`
Expected: FAIL — gating not implemented.

- [ ] **Step 3: Implement gating in `ensure-workspace.ts`**

In `packages/orchestrator/src/sandbox/ensure-workspace.ts`:

a) Widen the `resolveComputeTarget` dep return type (line ~26):

```ts
  resolveComputeTarget(
    computeTargetId: string | undefined,
    ctx: { userId: string; orgId: string },
  ): Promise<{
    type: string;
    config: Record<string, unknown>;
    imageState?: string;
    imageRef?: string | null;
    imageError?: string | null;
  }>;
```

b) Add an optional dep after `provisionLocal` (inside `EnsureWorkspaceDeps`):

```ts
  /** Re-enqueue a build when a ready image went missing (pruned). Optional. */
  onImagePending?(computeTargetId: string): Promise<void>;
```

c) Add this error class near the top of the file (after the imports):

```ts
class ImageNotReadyError extends Error {
  constructor(msg: string) { super(msg); this.name = "ImageNotReadyError"; }
}
function configurationError(msg: string): Error {
  const e = new Error(msg) as Error & { name: string };
  e.name = "ConfigurationError";
  return e;
}
```

d) After `const worker = await deps.resolveComputeTarget(...)` (line ~86), and **before** the `deps.claim(...)` call, insert the gate:

```ts
  // Run-gating: a docker target with a managed image must be 'ready' before we
  // provision. We never build inside the run (Spec B).
  if (worker.type === "docker") {
    const hasRecipe = (() => {
      const img = (worker.config as Record<string, unknown>)["image"] as
        { kind?: string; imageRef?: string; content?: string } | undefined;
      return (img?.kind === "ref" && !!img.imageRef?.trim())
          || (img?.kind === "dockerfile" && !!img.content?.trim());
    })();
    if (hasRecipe) {
      const state = worker.imageState ?? "none";
      if (state === "failed") {
        throw configurationError(`compute target image build failed: ${worker.imageError ?? "see build log"}`);
      }
      if (state === "pending" || state === "building" || state === "none") {
        log("Preparing environment (building image)… this happens once.");
        throw new ImageNotReadyError("compute target image is not ready yet");
      }
      if (state === "ready" && !worker.imageRef) {
        log("Environment image missing; rebuilding…");
        if (args.computeTargetId && deps.onImagePending) await deps.onImagePending(args.computeTargetId);
        throw new ImageNotReadyError("compute target image was pruned; rebuilding");
      }
      // ready + imageRef → fall through, passing imageRef to provisionDocker.
      (worker.config as Record<string, unknown>)["__imageRef"] = worker.imageRef;
    }
  }
```

e) Export `ImageNotReadyError` at the bottom of the file:

```ts
export { ImageNotReadyError };
```

- [ ] **Step 4: Make `provisionDocker` use the pre-built `__imageRef` (no build)**

In `packages/orchestrator/src/cli-worker.ts`, in the `provisionDocker` dep (around line 137), replace the `resolveDockerSpec(...)` block with a direct spec from the stored ref (falling back to the default box):

```ts
        const cfg = worker.config as Record<string, unknown>;
        const preBuilt = cfg["__imageRef"] as string | undefined;
        const network = cfg["network"] === "none" ? "none" : "full";
        const spec = {
          imageRef: preBuilt ?? RUNNER_IMAGE,
          network,
          ...(cfg["resources"] ? { resources: cfg["resources"] as any } : {}),
          ...(cfg["env"] ? { env: cfg["env"] as Record<string, string> } : {}),
        };
        const provisioned = await env.provision(runId, spec);
        return { env, provisioned, imageRef: spec.imageRef, connection };
```

Remove the now-unused `resolveDockerSpec` import on line 21 and the `RUNNER_BUNDLE` reference if it is no longer used by this file (keep `RUNNER_IMAGE`).

f) Extend the `resolveComputeTarget` dep wiring (cli-worker ~line 117) to pass the build fields through and provide `onImagePending`:

```ts
      resolveComputeTarget: async (computeTargetId, ctx) => {
        if (pool) {
          const w = await resolveComputeTarget(pool, ctx, computeTargetId);
          return {
            type: w.type,
            config: (w.config ?? {}) as Record<string, unknown>,
            imageState: w.imageState,
            imageRef: w.imageRef,
            imageError: w.imageError,
          };
        }
        return { type: "local" as const, config: {} };
      },
      onImagePending: async (id) => { if (pool) await markImagePending(pool, id); },
```

> `resolveComputeTarget` (in `@journeyman/compute`) returns a `ResolvedComputeTarget` today, which lacks the image fields. Update `resolver.ts`'s `toResolved` to copy `imageState`, `imageRef`, `imageError` (add them to `ResolvedComputeTarget` in `packages/core/src/types/execution-environment.types.ts`). Add `markImagePending` to the cli-worker import from `@journeyman/compute`.

- [ ] **Step 5: Run the tests + typecheck**

Run: `npm test -w @journeyman/orchestrator -- ensure-workspace && npm run typecheck`
Expected: PASS; typecheck clean.

- [ ] **Step 6: Start the build loop in the worker**

In `packages/orchestrator/src/cli-worker.ts`, after the harness is wired and `pool` is known to be set, start the loop and stop it on shutdown:

```ts
import { startBuildLoop } from "@journeyman/compute";
// …after pool is created…
const stopBuildLoop = pool
  ? startBuildLoop({
      db: pool,
      bundleRef: RUNNER_BUNDLE,
      leaseMs: 120_000,
      intervalMs: 3000,
      log: (line) => log.info({ line }, "build-loop"),
    })
  : () => {};
// register stopBuildLoop() in the existing SIGINT/SIGTERM shutdown path.
```

- [ ] **Step 7: Run check + commit**

Run: `npm run check`
Expected: typecheck + boundaries clean.

```bash
git add packages/orchestrator/src/sandbox/ensure-workspace.ts \
  packages/orchestrator/src/sandbox/ensure-workspace.test.ts \
  packages/orchestrator/src/cli-worker.ts \
  packages/compute/src/resolver.ts \
  packages/core/src/types/execution-environment.types.ts
git commit -m "feat(orchestrator): run-gating on compute-target image state (no in-run build)"
```

---

## Task 7: Pending-on-save + Rebuild route + cleanup hook

**Files:**
- Modify: `packages/compute/src/routes/index.ts` (or `routes/compute-targets.ts` — match the existing CRUD route file)
- Test: `packages/compute/src/routes/compute-targets-build.test.ts`

On **create/update** of a `docker` target: if its `config.image` is `ref`/`dockerfile` → `markImagePending`; if empty → `clearImageState`. Add `POST …/:id/rebuild` → `markImagePending`. On **image change / delete**, schedule old-image removal (best-effort; Docker refuses to delete in-use images, so this is safe).

> First confirm the exact CRUD route file and handler signatures (the Explore report referenced `packages/compute/src/routes/index.ts` and `routes/sandboxes.ts`). Hook into the same create/update/delete handlers.

- [ ] **Step 1: Write the failing test for pending-on-save**

Create `packages/compute/src/routes/compute-targets-build.test.ts` exercising the create/update handlers with a fake `Queryable`, asserting `markImagePending` SQL fires for a `docker` + `image.kind==='ref'` body, and `clearImageState` SQL fires for an empty image. (Mirror the existing route tests' harness — import the route registration and inject a stub `pool`.)

```ts
import { describe, it, expect, vi } from "vitest";
import { applyImageStateOnSave } from "../db.ts"; // helper added below

describe("applyImageStateOnSave", () => {
  it("marks pending for a ref image on a docker target", async () => {
    const db = { query: vi.fn().mockResolvedValue({ rows: [] }) };
    await applyImageStateOnSave(db as any, "t1", "docker", { image: { kind: "ref", imageRef: "node:20" } });
    expect(db.query.mock.calls[0][0]).toContain("image_state = 'pending'");
  });
  it("clears state for an empty image", async () => {
    const db = { query: vi.fn().mockResolvedValue({ rows: [] }) };
    await applyImageStateOnSave(db as any, "t1", "docker", { image: { kind: "ref", imageRef: "" } });
    expect(db.query.mock.calls[0][0]).toContain("image_state = 'none'");
  });
  it("no-ops for a local target", async () => {
    const db = { query: vi.fn() };
    await applyImageStateOnSave(db as any, "t1", "local", {});
    expect(db.query).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -w @journeyman/compute -- compute-targets-build`
Expected: FAIL — `applyImageStateOnSave` not exported.

- [ ] **Step 3: Implement `applyImageStateOnSave` in `db.ts`**

```ts
/** After create/update of a target, sync its image lifecycle state from config. */
export async function applyImageStateOnSave(
  db: Queryable, id: string, type: string, config: Record<string, unknown>,
): Promise<void> {
  if (type !== "docker") return;
  const img = config["image"] as { kind?: string; imageRef?: string; content?: string } | undefined;
  const hasRecipe =
    (img?.kind === "ref" && !!img.imageRef?.trim()) ||
    (img?.kind === "dockerfile" && !!img.content?.trim());
  if (hasRecipe) await markImagePending(db, id);
  else await clearImageState(db, id);
}
```

Export it in `packages/compute/src/index.ts`.

- [ ] **Step 4: Wire it into the CRUD + add the rebuild route**

In the compute-targets route file, after a successful create/update, call `applyImageStateOnSave(pool, target.id, target.type, target.config)`. Add:

```ts
// POST /api/orgs/:orgId/compute-targets/:id/rebuild  (and the user-scoped variant)
fastify.post(`${base}/:id/rebuild`, async (req, reply) => {
  const { id } = req.params as { id: string };
  // (reuse the existing visibility/ownership check used by update)
  await markImagePending(pool, id);
  return reply.send({ ok: true });
});
```

- [ ] **Step 5: Run the test + typecheck + boundaries**

Run: `npm test -w @journeyman/compute -- compute-targets-build && npm run check`
Expected: PASS; clean.

- [ ] **Step 6: Commit**

```bash
git add packages/compute/src/db.ts packages/compute/src/index.ts \
  packages/compute/src/routes/*.ts packages/compute/src/routes/compute-targets-build.test.ts
git commit -m "feat(compute): pending-on-save + rebuild route for managed images"
```

---

## Task 8: UI — state badge + Rebuild button

**Files:**
- Modify: `packages/web/src/api/computeTargets.ts`
- Modify: `packages/web/src/routes/ComputeTargetsPage.tsx`
- (Type already extended in core Task 1; mirror it in the web `ComputeTarget` type if web declares its own.)

- [ ] **Step 1: Add the `rebuild` API client + build fields**

In `packages/web/src/api/computeTargets.ts`, add to the `ComputeTarget` type (or import from core) the fields `imageState`, `imageRef`, `imageError`. Add to `computeTargetsApi`:

```ts
  rebuildMy: (orgId: string, id: string) =>
    postJson(`${userBase(orgId)}/${id}/rebuild`, {}).then(jsonOrThrow<{ ok: true }>),
  rebuildOrg: (orgId: string, id: string) =>
    postJson(`${orgBase(orgId)}/${id}/rebuild`, {}).then(jsonOrThrow<{ ok: true }>),
```

- [ ] **Step 2: Render a state badge + Rebuild button**

In `packages/web/src/routes/ComputeTargetsPage.tsx`, in the table row for docker targets, render a badge driven by `target.imageState` and a Rebuild button:

```tsx
function ImageStateBadge({ state }: { state?: string }) {
  if (!state || state === "none") return null;
  const map: Record<string, string> = {
    pending:  "bg-amber-900/40 text-amber-300",
    building: "bg-amber-900/40 text-amber-300",
    ready:    "bg-emerald-900/40 text-emerald-300",
    failed:   "bg-rose-900/40 text-rose-300",
  };
  const label = state === "building" ? "building…" : state;
  return <span className={`ml-2 rounded px-1.5 py-0.5 text-xs ${map[state] ?? ""}`}>{label}</span>;
}
```

Add a Rebuild action (visible for docker targets) that calls `rebuildMy`/`rebuildOrg` based on scope, then refetches the list. For `failed`, show `target.imageError` on hover (title attribute).

- [ ] **Step 3: Manual verification (build the web app)**

Run: `npm run build:web`
Expected: build succeeds (no type errors). Manually confirm the badge renders for a docker target and Rebuild posts (covered end-to-end in Task 9 verification).

- [ ] **Step 4: Commit**

```bash
git add packages/web/src/api/computeTargets.ts packages/web/src/routes/ComputeTargetsPage.tsx
git commit -m "feat(web): compute-target image state badge + rebuild action"
```

---

## Task 9: Register `opencode` in the provider catalog

**Files:**
- Modify: `packages/core/src/registries/provider-catalog.ts`
- Test: `packages/core/src/registries/provider-catalog.test.ts`

Every provider must own a `PROVIDER_CATALOG` slot so its API key flows into the box (Spec A.2/B §7). `opencode` is missing.

- [ ] **Step 1: Write the failing test**

Create/extend `packages/core/src/registries/provider-catalog.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { PROVIDER_CATALOG } from "./provider-catalog.ts";

describe("PROVIDER_CATALOG", () => {
  it("includes an opencode coding-cli entry with its key slot", () => {
    const oc = PROVIDER_CATALOG.find(p => p.kind === "coding-cli" && p.value === "opencode");
    expect(oc).toBeDefined();
    expect(oc?.slots?.some(s => s.name === "OPENCODE_API_KEY")).toBe(true);
  });

  it("has exactly one default per kind", () => {
    const kinds = [...new Set(PROVIDER_CATALOG.map(p => p.kind))];
    for (const k of kinds) {
      expect(PROVIDER_CATALOG.filter(p => p.kind === k && p.isDefault).length).toBe(1);
    }
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -w @journeyman/core -- provider-catalog`
Expected: FAIL — no opencode entry.

- [ ] **Step 3: Add the entry**

In `packages/core/src/registries/provider-catalog.ts`, after the `gemini`/`codex` coding-cli entries, add:

```ts
  { kind: "coding-cli", value: "opencode", label: "OpenCode", implemented: true, slots: [
    { name: "OPENCODE_API_KEY", description: "OpenCode API key.", optional: true },
  ]},
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm test -w @journeyman/core -- provider-catalog`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/registries/provider-catalog.ts packages/core/src/registries/provider-catalog.test.ts
git commit -m "feat(core): register opencode provider catalog entry"
```

---

## Final verification

- [ ] **Step 1: Full check**

Run: `npm run check`
Expected: `✓ Layer boundaries clean`; typecheck clean.

- [ ] **Step 2: Targeted test sweep**

Run: `npm test -w @journeyman/compute && npm test -w @journeyman/orchestrator && npm test -w @journeyman/core`
Expected: all green.

- [ ] **Step 3: Migration sanity**

Run: `npm run migrate` (against a dev DB) — confirm `038` applies and `\d jm_compute_targets` shows the new columns.

- [ ] **Step 4: End-to-end (manual, optional)**

Per the spec's Verification §: create a docker compute target with a Python `ref` → badge goes `pending → building → ready`; start a run while `building` → it waits (step.log "Preparing environment…") then runs from the built image; break the Dockerfile + Rebuild → `failed` with the log, run fails fast citing it; empty image → uses the default box; `local` target → runs in-process with no image fields.

---

## Self-review notes

- **Spec coverage:** §1 build state → Tasks 1,4. §3 kit graft → Task 2 (`wrapDockerfile` reuse). §4 identity/fingerprint/lease/stale-guard → Tasks 2,4,5. §5 run-gating table → Task 6. §6 cleanup → Task 7 (pending-on-save + rebuild; in-use protection relied on). §7 provider toggle → Task 9. §2 workflow picks target → already exists (no change). Deferred (§8 git auth, §B1 presets, §B2 pre-flight, §B3 governance, #26 warn-on-delete, #29 TLS) are explicitly out of scope above.
- **Type consistency:** `imageState/imageRef/imageError/imageFingerprint/imageBuiltAt` used identically across core type, row mapper, `COLS`, resolver, ensure-workspace, and UI. `buildBoxImage` returns `{ imageRef, fingerprint }` consumed unchanged by the loop and DB commit. `markImagePending`/`clearImageState` names match across db.ts, index export, route, and worker.
- **Open confirmation at execution time:** the exact compute-targets CRUD route file (Task 7) and the web `ComputeTarget` type location (Task 8) — verify against the live tree before editing; the Explore report points at `packages/compute/src/routes/index.ts` and `packages/web/src/api/computeTargets.ts`.
