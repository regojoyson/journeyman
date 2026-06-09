# Registry-backed Runner Kit Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the `docker save` → `.tar` → `docker load` runner-kit distribution with push/pull to a configurable container registry, pinned by digest, with a `kit_images` DB table as the source of truth for the current kit.

**Architecture:** `build:kit` builds and **pushes** the `runner-base` / `runner-bundle` images to a configurable registry, captures their digests, and writes `<base>/kit/kit.json`. A new `register-kit` CLI upserts those digests into a `kit_images` table (run after Postgres + migrations). Workers read the table, then **pull-if-absent** by digest (with optional registry credentials). The tar path is removed entirely.

**Tech Stack:** Node ESM + `tsx`, `dockerode` (Docker daemon API), PostgreSQL via `pg`, npm workspaces, Vitest.

> **Commit / typecheck policy (per user request):** Do **not** commit per task. Run each task's tests as you go, but make a **single commit at the very end** (Task 11) after a full `npm run check` passes.

---

## Background — current state (verified)

- `scripts/build-kit.mjs` builds two images and `docker save`s them to `<base>/kit/runner-bundle.tar` + `<base>/kit/runner-base.tar`.
- `packages/sandbox/src/backends/docker/ensure-kit.ts` exports `reconcileKitImage()`, which compares the tar's image id (`read-image-id-from-tar.ts`) against the daemon image id and `docker load`s when stale.
- `packages/sandbox/src/backends/docker/docker-client.ts`:
  - `IDockerClient` has `pullImage(ref)` (no auth), `loadImage(tarPath)`, `imageId(tag)`, `imageExists(tag)`. **No `pushImage`.**
  - `makeDockerClient(connection?)` factory at line ~258.
- `packages/orchestrator/src/cli-worker.ts`:
  - Constants `RUNNER_IMAGE` / `RUNNER_BUNDLE` (lines ~83–84) and `RUNNER_BUNDLE_TAR` / `RUNNER_BASE_TAR` (lines ~85–86).
  - `reconcileKitImage(...)` called at lines ~149 (in `verifyImageFresh`) and ~198 (in `provisionDocker`).
  - `pool` is a `pg` `Pool` (or `null`) created at line ~64.
- `packages/sandbox/src/build/build-loop.ts` uses `reconcileKitImage` as the default `ensureKit` dep.
- Migrations: numbered SQL files in `packages/migrations/src/sql/` (latest `041_coding_model_config.sql`); applied in sort order by `run-migrations.ts`. Next file: `042_kit_images.sql`.
- Sandbox DB seam: `packages/sandbox/src/db.ts` exports `interface Queryable { query(text, params?): Promise<{ rows: any[] }> }` plus accessor functions; re-exported from `packages/sandbox/src/index.ts`.

---

## File Structure

**Create:**
- `packages/migrations/src/sql/042_kit_images.sql` — the `kit_images` table.
- `packages/sandbox/src/kit/kit-images-store.ts` — `upsertKitImage`, `getKitImage`, `resolveKitRefs` over `Queryable`.
- `packages/sandbox/src/kit/kit-images-store.test.ts` — unit tests with a fake `Queryable`.
- `packages/sandbox/src/backends/docker/registry-auth.ts` — `registryAuthFromEnv(env)` → dockerode authconfig or `undefined`.
- `packages/sandbox/src/backends/docker/registry-auth.test.ts`.
- `packages/sandbox/src/backends/docker/ensure-kit.test.ts` — REWRITTEN for `ensureKitImage` (old content replaced).
- `scripts/register-kit.mjs` — reads `kit.json`, upserts `kit_images`.

**Modify:**
- `packages/sandbox/src/backends/docker/docker-client.ts` — add `pushImage(ref, auth?)`, add optional `auth` to `pullImage`.
- `packages/sandbox/src/backends/docker/docker-client.test.ts` (if present) — only if it references changed signatures.
- `packages/sandbox/src/backends/docker/ensure-kit.ts` — replace `reconcileKitImage` with `ensureKitImage`.
- `packages/sandbox/src/build/build-loop.ts` — default `ensureKit` → `ensureKitImage`; thread auth.
- `packages/sandbox/src/index.ts` — export new symbols; drop `reconcileKitImage`.
- `packages/orchestrator/src/cli-worker.ts` — resolve refs from DB, use `ensureKitImage`, drop tar paths.
- `scripts/build-kit.mjs` — build + push + write `kit.json`; remove `docker save`.
- `scripts/compose-up.sh` — reorder: build/push → migrate → register-kit → up.
- `.env.example` — add registry env vars.
- `docs/deploy-docker-compose.md` — rewrite the kit section.

**Delete:**
- `packages/sandbox/src/backends/docker/read-image-id-from-tar.ts`
- `packages/sandbox/src/backends/docker/read-image-id-from-tar.test.ts`

---

### Task 1: `kit_images` migration

**Files:**
- Create: `packages/migrations/src/sql/042_kit_images.sql`

- [ ] **Step 1: Write the migration SQL**

```sql
-- 042_kit_images.sql
-- Source of truth for the current runner-kit images. One row per role.
-- Written by `register-kit` after build:kit pushes to the registry; read by workers.
CREATE TABLE IF NOT EXISTS kit_images (
  role       TEXT PRIMARY KEY CHECK (role IN ('base', 'bundle')),
  image_ref  TEXT NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

- [ ] **Step 2: Verify it parses against a running DB (optional but recommended)**

Run: `npm run infra:up && npm run migrate`
Expected: log line `applying 042_kit_images`, no error. (Skip if no local infra; SQL is reviewed in Task 11's typecheck-independent check.)

---

### Task 2: `kit_images` DB store

**Files:**
- Create: `packages/sandbox/src/kit/kit-images-store.ts`
- Test: `packages/sandbox/src/kit/kit-images-store.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// packages/sandbox/src/kit/kit-images-store.test.ts
import { describe, it, expect, vi } from "vitest";
import { upsertKitImage, getKitImage, resolveKitRefs } from "./kit-images-store.ts";

function fakeDb(rows: any[] = []) {
  return { query: vi.fn().mockResolvedValue({ rows }) };
}

describe("kit-images-store", () => {
  it("upsertKitImage issues an INSERT ... ON CONFLICT upsert", async () => {
    const db = fakeDb();
    await upsertKitImage(db, "bundle", "reg/runner-bundle@sha256:abc");
    const [sql, params] = db.query.mock.calls[0];
    expect(sql).toMatch(/insert into kit_images/i);
    expect(sql).toMatch(/on conflict\s*\(role\)\s*do update/i);
    expect(params).toEqual(["bundle", "reg/runner-bundle@sha256:abc"]);
  });

  it("getKitImage returns the image_ref or null", async () => {
    expect(await getKitImage(fakeDb([{ image_ref: "reg/x@sha256:1" }]), "base")).toBe("reg/x@sha256:1");
    expect(await getKitImage(fakeDb([]), "base")).toBeNull();
  });

  it("resolveKitRefs returns DB rows when present", async () => {
    const db = {
      query: vi.fn()
        .mockResolvedValueOnce({ rows: [{ image_ref: "reg/base@sha256:b" }] })
        .mockResolvedValueOnce({ rows: [{ image_ref: "reg/bundle@sha256:c" }] }),
    };
    expect(await resolveKitRefs(db, { base: "fallback-base", bundle: "fallback-bundle" }))
      .toEqual({ base: "reg/base@sha256:b", bundle: "reg/bundle@sha256:c" });
  });

  it("resolveKitRefs falls back to provided defaults when a row is missing", async () => {
    const db = fakeDb([]); // every query → no rows
    expect(await resolveKitRefs(db, { base: "fallback-base", bundle: "fallback-bundle" }))
      .toEqual({ base: "fallback-base", bundle: "fallback-bundle" });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -w @journeyman/sandbox -- kit-images-store`
Expected: FAIL — module `./kit-images-store.ts` not found.

- [ ] **Step 3: Write the implementation**

```typescript
// packages/sandbox/src/kit/kit-images-store.ts
import type { Queryable } from "../db.ts";

export type KitRole = "base" | "bundle";

/** Insert-or-update the current image ref for a kit role. */
export async function upsertKitImage(db: Queryable, role: KitRole, imageRef: string): Promise<void> {
  await db.query(
    `INSERT INTO kit_images (role, image_ref, updated_at)
     VALUES ($1, $2, now())
     ON CONFLICT (role) DO UPDATE SET image_ref = EXCLUDED.image_ref, updated_at = now()`,
    [role, imageRef],
  );
}

/** Current image ref for a role, or null if not registered yet. */
export async function getKitImage(db: Queryable, role: KitRole): Promise<string | null> {
  const { rows } = await db.query(`SELECT image_ref FROM kit_images WHERE role = $1`, [role]);
  return rows[0]?.image_ref ?? null;
}

/**
 * Resolve both kit refs, preferring the DB rows and falling back to the
 * provided defaults (env-derived) when a row is absent.
 */
export async function resolveKitRefs(
  db: Queryable,
  defaults: { base: string; bundle: string },
): Promise<{ base: string; bundle: string }> {
  const [base, bundle] = await Promise.all([getKitImage(db, "base"), getKitImage(db, "bundle")]);
  return { base: base ?? defaults.base, bundle: bundle ?? defaults.bundle };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -w @journeyman/sandbox -- kit-images-store`
Expected: PASS (4 tests).

---

### Task 3: Registry auth from env

**Files:**
- Create: `packages/sandbox/src/backends/docker/registry-auth.ts`
- Test: `packages/sandbox/src/backends/docker/registry-auth.test.ts`

> dockerode authconfig shape: `{ username, password, serveraddress }`. `serveraddress` is the registry **host** (the part of the prefix before the first `/`). For `ghcr.io/acme` → `ghcr.io`; for `localhost:5000` → `localhost:5000`.

- [ ] **Step 1: Write the failing test**

```typescript
// packages/sandbox/src/backends/docker/registry-auth.test.ts
import { describe, it, expect } from "vitest";
import { registryAuthFromEnv, registryHost } from "./registry-auth.ts";

describe("registry-auth", () => {
  it("registryHost strips the path from the prefix", () => {
    expect(registryHost("ghcr.io/acme")).toBe("ghcr.io");
    expect(registryHost("localhost:5000")).toBe("localhost:5000");
    expect(registryHost("registry.gitlab.com/acme/journeyman")).toBe("registry.gitlab.com");
  });

  it("returns undefined when no token is set", () => {
    expect(registryAuthFromEnv({ JOURNEYMAN_REGISTRY: "ghcr.io/acme" })).toBeUndefined();
  });

  it("builds an authconfig when username + token are set", () => {
    expect(registryAuthFromEnv({
      JOURNEYMAN_REGISTRY: "ghcr.io/acme",
      JOURNEYMAN_REGISTRY_USERNAME: "bot",
      JOURNEYMAN_REGISTRY_TOKEN: "secret",
    })).toEqual({ username: "bot", password: "secret", serveraddress: "ghcr.io" });
  });

  it("defaults username to empty string when only a token is set (token-only registries)", () => {
    expect(registryAuthFromEnv({
      JOURNEYMAN_REGISTRY: "localhost:5000",
      JOURNEYMAN_REGISTRY_TOKEN: "t",
    })).toEqual({ username: "", password: "t", serveraddress: "localhost:5000" });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -w @journeyman/sandbox -- registry-auth`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the implementation**

```typescript
// packages/sandbox/src/backends/docker/registry-auth.ts

/** dockerode push/pull auth payload. */
export interface RegistryAuth {
  username: string;
  password: string;
  serveraddress: string;
}

/** Registry host = the prefix up to the first "/". */
export function registryHost(prefix: string): string {
  return prefix.split("/")[0];
}

/**
 * Build a dockerode authconfig from env, or undefined for anonymous (local/open)
 * registries. Auth is keyed on a token being present; username is optional.
 */
export function registryAuthFromEnv(env: Record<string, string | undefined>): RegistryAuth | undefined {
  const token = env.JOURNEYMAN_REGISTRY_TOKEN;
  const prefix = env.JOURNEYMAN_REGISTRY;
  if (!token || !prefix) return undefined;
  return {
    username: env.JOURNEYMAN_REGISTRY_USERNAME ?? "",
    password: token,
    serveraddress: registryHost(prefix),
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -w @journeyman/sandbox -- registry-auth`
Expected: PASS (4 tests).

---

### Task 4: `pushImage` + auth on `pullImage`

**Files:**
- Modify: `packages/sandbox/src/backends/docker/docker-client.ts`

> Reuse the existing `followProgress` error-scanning pattern already used by `loadImage`/`pullImage`. `push` returns the manifest digest in an `aux.Digest` progress event — capture it and return `"<ref>@<digest>"`.

- [ ] **Step 1: Add `pushImage` + `auth` arg to the `IDockerClient` interface**

In `packages/sandbox/src/backends/docker/docker-client.ts`, find the interface members for `loadImage` / `pullImage` and update to:

```typescript
  /** Load an image into the daemon from a `docker save` tar at `tarPath` (streams from this process). */
  loadImage(tarPath: string): Promise<void>;
  /** Pull `ref` from its registry. Best-effort: callers decide how to handle failure. */
  pullImage(ref: string, auth?: import("./registry-auth.ts").RegistryAuth): Promise<void>;
  /** Push `ref` to its registry; resolves to the pushed manifest ref `<ref>@sha256:…`. */
  pushImage(ref: string, auth?: import("./registry-auth.ts").RegistryAuth): Promise<string>;
```

- [ ] **Step 2: Update the `DockerodeClient.pullImage` implementation to pass auth**

Replace the existing `async pullImage(ref: string)` method body's first line:

```typescript
  async pullImage(ref: string, auth?: import("./registry-auth.ts").RegistryAuth): Promise<void> {
    const stream = await this.docker.pull(ref, auth ? { authconfig: auth } : {});
    await new Promise<void>((resolve, reject) => {
      this.docker.modem.followProgress(
        stream,
        (err: Error | null, output?: Array<Record<string, any>>) => {
          if (err) return reject(err);
          const failed = (output ?? []).find((e) => e && (e.error || e.errorDetail));
          if (failed) {
            return reject(new Error(String(failed.error ?? failed.errorDetail?.message ?? "docker pull failed")));
          }
          resolve();
        },
      );
    });
  }
```

- [ ] **Step 3: Add the `pushImage` implementation**

Immediately after `pullImage` in `DockerodeClient`:

```typescript
  async pushImage(ref: string, auth?: import("./registry-auth.ts").RegistryAuth): Promise<string> {
    const image = this.docker.getImage(ref);
    const stream = await image.push(auth ? { authconfig: auth } : {});
    return await new Promise<string>((resolve, reject) => {
      let digest: string | undefined;
      this.docker.modem.followProgress(
        stream,
        (err: Error | null, output?: Array<Record<string, any>>) => {
          if (err) return reject(err);
          const failed = (output ?? []).find((e) => e && (e.error || e.errorDetail));
          if (failed) {
            return reject(new Error(String(failed.error ?? failed.errorDetail?.message ?? "docker push failed")));
          }
          if (!digest) return reject(new Error(`push of '${ref}' returned no digest`));
          resolve(`${ref.split("@")[0].split(":")[0]}@${digest}`);
        },
        (event: Record<string, any>) => {
          if (event?.aux?.Digest) digest = String(event.aux.Digest);
        },
      );
    });
  }
```

> Note: `ref.split("@")[0].split(":")[0]` strips any existing `@digest` and `:tag` so the returned ref is `<repo>@sha256:…`. Callers pass a `:tag` ref to push (e.g. `reg/runner-bundle:dev`).

- [ ] **Step 4: Quick smoke compile**

Run: `npm run typecheck -w @journeyman/sandbox`
Expected: PASS (no type errors from the new members). If a fake client in existing tests now misses `pushImage`, fix those fakes in Task 6/7's edits (they are addressed there).

---

### Task 5: Replace `reconcileKitImage` with `ensureKitImage`

**Files:**
- Modify: `packages/sandbox/src/backends/docker/ensure-kit.ts`
- Rewrite: `packages/sandbox/src/backends/docker/ensure-kit.test.ts`
- Delete: `packages/sandbox/src/backends/docker/read-image-id-from-tar.ts` and its `.test.ts`

- [ ] **Step 1: Rewrite the test for digest-pinned pull-if-absent**

Replace the entire contents of `packages/sandbox/src/backends/docker/ensure-kit.test.ts`:

```typescript
import { describe, it, expect, vi } from "vitest";
import { ensureKitImage } from "./ensure-kit.ts";

function client(present: boolean) {
  return {
    imageExists: vi.fn().mockResolvedValue(present),
    pullImage: vi.fn().mockResolvedValue(undefined),
  };
}

describe("ensureKitImage", () => {
  it("pulls when the image is absent", async () => {
    const c = client(false);
    await ensureKitImage(c as any, "reg/runner-base@sha256:abc");
    expect(c.pullImage).toHaveBeenCalledWith("reg/runner-base@sha256:abc", undefined);
  });

  it("skips the pull when the image is already present (digest-pinned)", async () => {
    const c = client(true);
    await ensureKitImage(c as any, "reg/runner-base@sha256:abc");
    expect(c.pullImage).not.toHaveBeenCalled();
  });

  it("passes auth through to the pull", async () => {
    const c = client(false);
    const auth = { username: "u", password: "p", serveraddress: "reg" };
    await ensureKitImage(c as any, "reg/x@sha256:1", auth as any);
    expect(c.pullImage).toHaveBeenCalledWith("reg/x@sha256:1", auth);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -w @journeyman/sandbox -- ensure-kit`
Expected: FAIL — `ensureKitImage` is not exported (file still defines `reconcileKitImage`).

- [ ] **Step 3: Replace `ensure-kit.ts` contents**

```typescript
// packages/sandbox/src/backends/docker/ensure-kit.ts
import type { IDockerClient } from "./docker-client.ts";
import type { RegistryAuth } from "./registry-auth.ts";

/**
 * Ensure a digest-pinned kit image is present on the daemon. Because the ref is
 * pinned by digest (`<repo>@sha256:…`), presence is sufficient — pull only when
 * absent, never compare ids, never load tars.
 */
export async function ensureKitImage(
  client: IDockerClient,
  ref: string,
  auth?: RegistryAuth,
  log: (line: string) => void = () => {},
): Promise<void> {
  if (await client.imageExists(ref)) return;
  log(`pulling kit image ${ref}`);
  await client.pullImage(ref, auth);
}
```

- [ ] **Step 4: Delete the tar id reader (no longer referenced)**

Run:
```bash
git rm packages/sandbox/src/backends/docker/read-image-id-from-tar.ts \
       packages/sandbox/src/backends/docker/read-image-id-from-tar.test.ts
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npm test -w @journeyman/sandbox -- ensure-kit`
Expected: PASS (3 tests).

---

### Task 6: Update build-loop default + sandbox exports

**Files:**
- Modify: `packages/sandbox/src/build/build-loop.ts`
- Modify: `packages/sandbox/src/index.ts`

- [ ] **Step 1: Swap the default `ensureKit` and its signature in `build-loop.ts`**

Change the import:
```typescript
import { ensureKitImage } from "../backends/docker/ensure-kit.ts";
```

Change the `BuildTickDeps` field doc + type and the default:
```typescript
  /** Optional registry auth for pulling the kit bundle. */
  kitAuth?: import("../backends/docker/registry-auth.ts").RegistryAuth;
  ensureKit?: (client: any, ref: string, auth?: any, log?: (l: string) => void) => Promise<void>;
```
```typescript
  const ensureKit = deps.ensureKit ?? ensureKitImage;
```

And update the call site inside `runBuildTick` (the line that currently calls `ensureKit(client, deps.bundleRef, deps.bundleTarPath, log)`):
```typescript
    // The box recipe grafts the kit via `COPY --from=<bundleRef>`; ensure that
    // kit image exists on this daemon first (pulled from the registry by digest).
    await ensureKit(client, deps.bundleRef, deps.kitAuth, log);
```

Also **remove** the now-unused `bundleTarPath` field from `BuildTickDeps` (delete its declaration and the `if (deps.bundleTarPath)` guard — `bundleRef` is always required now).

- [ ] **Step 2: Update `packages/sandbox/src/index.ts` exports**

Remove:
```typescript
export { reconcileKitImage } from "./backends/docker/ensure-kit.ts";
```
Add:
```typescript
export { ensureKitImage } from "./backends/docker/ensure-kit.ts";
export { registryAuthFromEnv, registryHost } from "./backends/docker/registry-auth.ts";
export type { RegistryAuth } from "./backends/docker/registry-auth.ts";
export { upsertKitImage, getKitImage, resolveKitRefs } from "./kit/kit-images-store.ts";
export type { KitRole } from "./kit/kit-images-store.ts";
```

- [ ] **Step 3: Update build-loop tests that referenced the old signature**

Run: `npm test -w @journeyman/sandbox -- build-loop`
Expected: may FAIL if `build-loop.test.ts` passes `bundleTarPath` or a 3-arg `ensureKit`. Fix those mocks: drop `bundleTarPath`, and update any `ensureKit` mock assertion to `(client, bundleRef, auth, log)`. Re-run until PASS.

---

### Task 7: Rewrite `build:kit` (build + push + kit.json)

**Files:**
- Modify: `scripts/build-kit.mjs`

> This script runs on the host with no DB. It builds, pushes by tag, captures each digest, and writes `kit.json`. It uses the same `dockerode` client the app uses so push/digest capture is consistent. The registry prefix is required.

- [ ] **Step 1: Replace `scripts/build-kit.mjs` contents**

```javascript
#!/usr/bin/env node
// Build the Journeyman "kit" images and PUSH them to a configurable registry.
// Captures each pushed manifest digest and writes <out>/kit.json. No tars.
//
// Required env:
//   JOURNEYMAN_REGISTRY            e.g. localhost:5000 | ghcr.io/acme | registry.gitlab.com/acme/jm
// Optional env:
//   JOURNEYMAN_REGISTRY_USERNAME / JOURNEYMAN_REGISTRY_TOKEN   creds for private registries
//   JOURNEYMAN_BASE_DIR           data root (kit.json goes under <root>/kit)
//   KIT_OUT_DIR                   explicit output dir (wins over base/kit)
//   DOCKER_HOST                   which daemon to build/push on
import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { config as loadDotenv } from "dotenv";
import { makeDockerClient } from "@journeyman/sandbox";
import { registryAuthFromEnv } from "@journeyman/sandbox";

loadDotenv();

const registry = process.env.JOURNEYMAN_REGISTRY;
if (!registry) {
  console.error("ERROR: JOURNEYMAN_REGISTRY is required (e.g. localhost:5000 or ghcr.io/acme)");
  process.exit(1);
}

const repoRoot = process.cwd();
const base = process.env.JOURNEYMAN_BASE_DIR ?? join(homedir(), ".journeyman");
const argOut = (() => { const i = process.argv.indexOf("--out"); return i !== -1 ? process.argv[i + 1] : undefined; })();
const outDir = argOut ?? process.env.KIT_OUT_DIR ?? join(base, "kit");

const targets = [
  { role: "bundle", repo: `${registry}/runner-bundle`, tag: `${registry}/runner-bundle:dev`, dockerfile: "docker/runner-bundle.Dockerfile" },
  { role: "base",   repo: `${registry}/runner-base`,   tag: `${registry}/runner-base:dev`,   dockerfile: "docker/runner-base.Dockerfile" },
];

function run(cmd, args) {
  console.log(`$ ${cmd} ${args.join(" ")}`);
  execFileSync(cmd, args, { stdio: "inherit", cwd: repoRoot });
}

mkdirSync(outDir, { recursive: true });
const client = makeDockerClient();
const auth = registryAuthFromEnv(process.env);
const kit = {};

for (const t of targets) {
  console.log(`\n=== build ${t.tag} (${t.dockerfile}) ===`);
  run("docker", ["build", "-f", t.dockerfile, "-t", t.tag, "."]);
  console.log(`\n=== push ${t.tag} ===`);
  const pinned = await client.pushImage(t.tag, auth);
  console.log(`pushed ${t.role}: ${pinned}`);
  kit[t.role] = pinned;
}

const kitJsonPath = join(outDir, "kit.json");
writeFileSync(kitJsonPath, JSON.stringify(kit, null, 2) + "\n");
console.log(`\n✓ Kit pushed. Digests written to ${kitJsonPath}`);
console.log(`  base:   ${kit.base}`);
console.log(`  bundle: ${kit.bundle}`);
console.log(`\nNext: run 'node scripts/register-kit.mjs' (after the DB is up) to record these in kit_images.`);
```

- [ ] **Step 2: Manual verification against a local registry**

Run:
```bash
docker run -d -p 5000:5000 --name jm-test-registry registry:2
JOURNEYMAN_REGISTRY=localhost:5000 node scripts/build-kit.mjs
cat "${JOURNEYMAN_BASE_DIR:-$HOME/.journeyman}/kit/kit.json"
```
Expected: `kit.json` contains `base` and `bundle` keys with `localhost:5000/runner-*@sha256:…` values. (Cleanup: `docker rm -f jm-test-registry`.)

---

### Task 8: `register-kit` CLI

**Files:**
- Create: `scripts/register-kit.mjs`

> Runs after Postgres + migrations are up. Reads `kit.json` and upserts both rows via the sandbox store, using the same `DATABASE_URL` the worker uses.

- [ ] **Step 1: Write `scripts/register-kit.mjs`**

```javascript
#!/usr/bin/env node
// Read <base>/kit/kit.json (written by build:kit) and upsert the digests into
// the kit_images table. Requires DATABASE_URL and an applied 042 migration.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { config as loadDotenv } from "dotenv";
import { Pool } from "pg";
import { upsertKitImage } from "@journeyman/sandbox";

loadDotenv();

const dbUrl = process.env.DATABASE_URL;
if (!dbUrl) { console.error("ERROR: DATABASE_URL is required"); process.exit(1); }

const base = process.env.JOURNEYMAN_BASE_DIR ?? join(homedir(), ".journeyman");
const outDir = process.env.KIT_OUT_DIR ?? join(base, "kit");
const kitJsonPath = join(outDir, "kit.json");

let kit;
try {
  kit = JSON.parse(readFileSync(kitJsonPath, "utf8"));
} catch (err) {
  console.error(`ERROR: cannot read ${kitJsonPath} — run 'npm run build:kit' first. (${err.message})`);
  process.exit(1);
}
if (!kit.base || !kit.bundle) {
  console.error(`ERROR: ${kitJsonPath} is missing base/bundle refs`);
  process.exit(1);
}

const pool = new Pool({ connectionString: dbUrl });
try {
  await upsertKitImage(pool, "base", kit.base);
  await upsertKitImage(pool, "bundle", kit.bundle);
  console.log("✓ registered kit_images:");
  console.log(`  base:   ${kit.base}`);
  console.log(`  bundle: ${kit.bundle}`);
} finally {
  await pool.end();
}
```

- [ ] **Step 2: Add npm scripts**

In root `package.json` `"scripts"`, add `register-kit` next to `build:kit`:
```json
    "build:kit": "node scripts/build-kit.mjs",
    "register-kit": "node scripts/register-kit.mjs",
```

- [ ] **Step 3: Manual verification (continues from Task 7's local registry)**

Run:
```bash
npm run infra:up && npm run migrate
DATABASE_URL=${DATABASE_URL:-postgres://postgres:postgres@localhost:5433/journeyman} node scripts/register-kit.mjs
```
Expected: prints `✓ registered kit_images:` with the two digest refs.

---

### Task 9: Wire the worker to the registry + DB

**Files:**
- Modify: `packages/orchestrator/src/cli-worker.ts`

- [ ] **Step 1: Update imports + constants**

In the `@journeyman/sandbox` import block, replace `reconcileKitImage` with the new symbols:
```typescript
  markImagePending, startBuildLoop, ensureKitImage, resolveBuildInputs, pruneBuiltImages,
  listReadyImageRefs, resolveKitRefs, registryAuthFromEnv,
```

Replace the kit constants (lines ~83–86) with:
```typescript
const RUNNER_IMAGE = process.env.JOURNEYMAN_RUNNER_IMAGE ?? "journeyman/runner-base:dev";
const RUNNER_BUNDLE = process.env.JOURNEYMAN_RUNNER_BUNDLE ?? "journeyman/runner-bundle:dev";
const REGISTRY_AUTH = registryAuthFromEnv(process.env);

/** Resolve the current kit refs (DB-first, env defaults as fallback). */
async function kitRefs(): Promise<{ base: string; bundle: string }> {
  if (!pool) return { base: RUNNER_IMAGE, bundle: RUNNER_BUNDLE };
  return resolveKitRefs(pool, { base: RUNNER_IMAGE, bundle: RUNNER_BUNDLE });
}
```
(Delete `RUNNER_BUNDLE_TAR` / `RUNNER_BASE_TAR`.)

- [ ] **Step 2: Update `verifyImageFresh` (the ~line 149 `reconcileKitImage` call)**

Replace the body around the old call:
```typescript
      verifyImageFresh: async ({ config, storedFingerprint, storedImageRef }) => {
        const connection = (config as Record<string, unknown>)["connection"] ?? { kind: "local" };
        const client = makeDockerClient(connection as Parameters<typeof makeDockerClient>[0]);
        const { bundle } = await kitRefs();
        // Ensure the kit bundle is present (pulled by digest) before recomputing
        // the expected fingerprint.
        await ensureKitImage(client, bundle, REGISTRY_AUTH);
        const inputs = await resolveBuildInputs({
          image: (config as Record<string, unknown>)["image"] as never,
          client,
          bundleRef: bundle,
        });
        const present = await client.imageExists(storedImageRef);
        const fresh = present && inputs.fingerprint === storedFingerprint;
        return {
          fresh,
          ...(fresh ? {} : { reason: `image drift: expected ${inputs.fingerprint}, have ${storedFingerprint || "none"}${present ? "" : " (image pruned)"}` }),
        };
      },
```

- [ ] **Step 3: Update `provisionDocker` (the ~line 198 `reconcileKitImage` call)**

Replace the relevant lines:
```typescript
        const cfg = worker.config as Record<string, unknown>;
        const preBuilt = cfg["__imageRef"] as string | undefined;
        const { base: baseRef } = await kitRefs();
        const imageRef = preBuilt ?? baseRef;
        // Empty-image targets run the default box directly (no build loop), so the
        // kit base must be present on this daemon — pull it by digest if missing.
        if (!preBuilt) await ensureKitImage(dockerClient, baseRef, REGISTRY_AUTH);
```

Also update the `DockerExecutionEnvironment` construction `defaultImage: RUNNER_IMAGE` → keep as-is (it's only the fallback default and `imageRef` is always passed in the spec); no change needed.

- [ ] **Step 4: Update the build-loop wiring (where `startBuildLoop` is configured, ~line 425)**

Ensure the build loop receives the bundle ref + auth and no tar path. Find the `startBuildLoop({...})` call and set:
```typescript
        bundleRef: (await kitRefs()).bundle,
        kitAuth: REGISTRY_AUTH,
```
Remove any `bundleTarPath: RUNNER_BUNDLE_TAR` field if present.

- [ ] **Step 5: Typecheck the orchestrator**

Run: `npm run typecheck -w @journeyman/orchestrator`
Expected: PASS. Fix any remaining references to `reconcileKitImage` / `RUNNER_*_TAR`.

---

### Task 10: Deployment glue — env, compose ordering, docs

**Files:**
- Modify: `.env.example`
- Modify: `scripts/compose-up.sh`
- Modify: `docs/deploy-docker-compose.md`

- [ ] **Step 1: Add registry env to `.env.example`**

Append:
```bash
# --- Runner kit registry (replaces the old tar kit) ---
# Any OCI registry: local (localhost:5000), GHCR (ghcr.io/acme),
# GitLab (registry.gitlab.com/acme/journeyman), Docker Hub, ECR, …
JOURNEYMAN_REGISTRY=localhost:5000
# Optional credentials for private registries (leave blank for open/local):
JOURNEYMAN_REGISTRY_USERNAME=
JOURNEYMAN_REGISTRY_TOKEN=
```

- [ ] **Step 2: Reorder `scripts/compose-up.sh`**

Replace the kit-build block (the `echo ">>> building runner kit …"` + `JOURNEYMAN_BASE_DIR=… npm run build:kit` lines) and the tail so the sequence is: build+push kit → bring up Postgres + run migrations → register-kit → bring up the rest. Concretely:

```bash
# Require the registry target.
registry="$(grep -E '^JOURNEYMAN_REGISTRY=' .env 2>/dev/null | head -n1 | cut -d= -f2- || true)"
if [ -z "$registry" ]; then
  echo "ERROR: JOURNEYMAN_REGISTRY is not set in .env (e.g. localhost:5000)" >&2
  exit 1
fi

echo ">>> building + pushing runner kit to ${registry}"
JOURNEYMAN_BASE_DIR="${data_dir}" npm run build:kit

./scripts/build-images.sh

echo ">>> bringing up postgres + running migrations"
docker compose -f compose.deploy.yml up -d postgres
docker compose -f compose.deploy.yml run --rm migrations

echo ">>> registering kit images in the DB"
JOURNEYMAN_BASE_DIR="${data_dir}" npm run register-kit

docker compose -f compose.deploy.yml up -d
docker compose -f compose.deploy.yml ps
```

> If `register-kit` needs `DATABASE_URL` pointing at the *host-exposed* Postgres port, set it inline (matching the `migrate` script default): `DATABASE_URL=postgres://postgres:postgres@localhost:5433/journeyman npm run register-kit`. Use whichever port `compose.deploy.yml` publishes for postgres.

- [ ] **Step 3: Rewrite the kit section of `docs/deploy-docker-compose.md`**

Replace the "## 2. (Automatic) The runner kit" section body with a registry description:

```markdown
## 2. The runner kit (registry)

Runner images are **pushed to a container registry** and pulled by workers — no
more tar files. Set the target registry in `.env`:

- `JOURNEYMAN_REGISTRY` — e.g. `localhost:5000`, `ghcr.io/acme`,
  `registry.gitlab.com/acme/journeyman`.
- `JOURNEYMAN_REGISTRY_USERNAME` / `JOURNEYMAN_REGISTRY_TOKEN` — optional, for
  private registries.

`compose:up` runs the full publish flow for you: it builds + pushes the kit,
runs migrations, then records the pushed image **digests** in the `kit_images`
table via `register-kit`. Workers read that table and pull the exact digest.

To roll a new kit: `npm run build:kit && npm run register-kit` (workers pick up
the new digest automatically — no redeploy).

For a quick local registry: `docker run -d -p 5000:5000 registry:2` and set
`JOURNEYMAN_REGISTRY=localhost:5000`.
```

- [ ] **Step 4: Grep for any straggler references to the old tar kit**

Run:
```bash
grep -rn "runner-bundle.tar\|runner-base.tar\|reconcileKitImage\|read-image-id-from-tar\|docker save\|RUNNER_BUNDLE_TAR\|RUNNER_BASE_TAR" \
  packages scripts docs --include="*.ts" --include="*.mjs" --include="*.sh" --include="*.md"
```
Expected: no matches (or only inside this plan / the spec doc). Fix any code/script/doc stragglers found.

---

### Task 11: Final typecheck + single commit

**Files:** none (verification + commit)

- [ ] **Step 1: Full sandbox + orchestrator test pass**

Run: `npm test -w @journeyman/sandbox`
Expected: PASS (new + existing). Investigate any failure before continuing.

- [ ] **Step 2: Full repo check (typecheck + import boundaries)**

Run: `npm run check`
Expected: PASS. `npm run check` = `npm run typecheck && npm run check:boundaries`. Fix any type errors or boundary violations (e.g. ensure `scripts/*.mjs` importing `@journeyman/sandbox` is allowed; if the boundary script flags scripts, prefer importing from the package's public `src/index.ts` which is already the export surface).

- [ ] **Step 3: Stage and commit everything (single commit, per request)**

```bash
git add -A
git commit -m "$(cat <<'EOF'
feat(sandbox): distribute runner kit via registry instead of tar

Push runner-base/runner-bundle to a configurable registry, pin by digest,
record current refs in a kit_images table, and pull-if-absent on workers.
Adds pushImage + auth, ensureKitImage, register-kit CLI; removes docker save,
the .tar kit, reconcileKitImage, and read-image-id-from-tar.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

Expected: one commit containing the migration, store, auth helper, client changes, scripts, worker wiring, env/compose/docs.

---

## Self-Review (completed during authoring)

- **Spec coverage:** config surface (Task 10), digest pinning (Tasks 4–5), DB source of truth (Tasks 1–2, 8–9), optional credentials (Tasks 3–4), full tar removal (Tasks 5–7, 10) — all mapped.
- **Type consistency:** `ensureKitImage(client, ref, auth?, log?)`, `pushImage(ref, auth?) → string`, `pullImage(ref, auth?)`, `resolveKitRefs(db, {base,bundle})`, `upsertKitImage(db, role, ref)`, `RegistryAuth{username,password,serveraddress}` — used consistently across tasks.
- **Placeholders:** none — every code/SQL/script step shows full content.
- **Note:** the env-default fallback in `resolveKitRefs`/`kitRefs()` is intentional (graceful local dev when the table is empty); the DB row remains the source of truth when present, satisfying the spec.
