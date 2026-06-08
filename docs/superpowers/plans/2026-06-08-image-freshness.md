# Image Freshness Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make every workflow run use the *latest* built image — reload kit tars when their contents change, rebuild boxes when the kit or base ref moves, and gate a run until its box is fresh — instead of silently reusing a stale image that is already on the daemon.

**Architecture:** Replace every "use the image if it *exists*" check with "use it if it exists *and matches the current source*." The kit loader compares the tar's embedded image id to the loaded image id; the box fingerprint folds in the kit's image id and the (freshly-pulled) base-ref id; and the per-run gate recomputes the expected fingerprint and re-enqueues a rebuild on drift. Drift detection is cheap, so it runs per use/per run; reload/rebuild happen only on actual change.

**Tech Stack:** TypeScript (Node, ESM, `.ts` imports), `dockerode` via the `IDockerClient` wrapper, `tar` v7 (already a dep of `@journeyman/sandbox`), Vitest, PostgreSQL via `pg`.

---

## File Structure

**`@journeyman/sandbox`**
- Create: `packages/sandbox/src/backends/docker/read-image-id-from-tar.ts` — read a `docker save` tar's image id from its `manifest.json` (Task 1).
- Create: `packages/sandbox/src/backends/docker/read-image-id-from-tar.test.ts` (Task 1).
- Modify: `packages/sandbox/src/backends/docker/ensure-kit.ts` — `ensureKitImage` → `reconcileKitImage` (compare-and-reload) (Task 2).
- Modify: `packages/sandbox/src/backends/docker/ensure-kit.test.ts` — rewrite for compare-and-reload (Task 2).
- Modify: `packages/sandbox/src/index.ts` — export `reconcileKitImage` instead of `ensureKitImage` (Task 2).
- Modify: `packages/sandbox/src/build/build-loop.ts` — default the `ensureKit` seam to `reconcileKitImage` (Task 2).
- Modify: `packages/sandbox/src/backends/docker/docker-client.ts` — add `pullImage`; add `pull?` to `buildImage` (Task 3).
- Modify: `packages/sandbox/src/backends/docker/docker-client.test.ts` — `pullImage` + `pull` build flag (Task 3).
- Modify: `packages/sandbox/src/backends/docker/recipe.ts` — `computeFingerprint` gains `baseRefId` (Task 4).
- Modify: `packages/sandbox/src/backends/docker/recipe.test.ts` — `baseRefId` cases (Task 4).
- Create: `packages/sandbox/src/backends/docker/resolve-build-inputs.ts` — shared `resolveBuildInputs()` (Task 4).
- Create: `packages/sandbox/src/backends/docker/resolve-build-inputs.test.ts` (Task 4).
- Modify: `packages/sandbox/src/backends/docker/build-image.ts` — use `resolveBuildInputs`; pass `pull` for dockerfiles (Task 4).
- Modify: `packages/sandbox/src/backends/docker/build-image.test.ts` — fake client gains `pullImage` (Task 4).
- Modify: `packages/sandbox/src/resolver.ts` — surface `imageFingerprint` in `ResolvedSandbox` (Task 5).
- Create: `packages/sandbox/src/backends/docker/prune-built-images.ts` — prune orphaned `jm-built:*` (Task 6).
- Create: `packages/sandbox/src/backends/docker/prune-built-images.test.ts` (Task 6).

**`@journeyman/core`**
- Modify: `packages/core/src/types/execution-environment.types.ts` — add `imageFingerprint?` to `ResolvedSandbox` (Task 5).

**`@journeyman/orchestrator`**
- Modify: `packages/orchestrator/src/sandbox/ensure-workspace.ts` — add `verifyImageFresh` dep + drift gate (Task 5).
- Modify: `packages/orchestrator/src/sandbox/ensure-workspace.test.ts` — drift gate cases (Task 5).
- Modify: `packages/orchestrator/src/cli-worker.ts` — rename import; wire `verifyImageFresh`; pass `imageFingerprint`; optionally call prune (Tasks 2, 5, 6).

---

## Task 1: Tar image-id reader

Reads the image id baked into a `docker save` tar by parsing only its `manifest.json`. This is the "what does the tar actually contain" half of kit drift detection.

**Files:**
- Create: `packages/sandbox/src/backends/docker/read-image-id-from-tar.ts`
- Test: `packages/sandbox/src/backends/docker/read-image-id-from-tar.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// packages/sandbox/src/backends/docker/read-image-id-from-tar.test.ts
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { create as tarCreate } from "tar";
import { writeFile, mkdir } from "node:fs/promises";
import { readImageIdFromTar } from "./read-image-id-from-tar.ts";

let dir = "";
beforeEach(async () => { dir = await mkdtemp(join(tmpdir(), "tarid-")); });
afterEach(async () => { await rm(dir, { recursive: true, force: true }); });

/** Build a minimal docker-save-shaped tar with the given manifest.json contents. */
async function makeTar(manifest: unknown): Promise<string> {
  const stage = join(dir, "stage");
  await mkdir(stage, { recursive: true });
  await writeFile(join(stage, "manifest.json"), JSON.stringify(manifest), "utf8");
  await writeFile(join(stage, "layer.bin"), "x".repeat(1024), "utf8");
  const tarPath = join(dir, "img.tar");
  await tarCreate({ file: tarPath, cwd: stage }, ["layer.bin", "manifest.json"]);
  return tarPath;
}

describe("readImageIdFromTar", () => {
  it("reads the legacy Config '<hex>.json' as sha256:<hex>", async () => {
    const tarPath = await makeTar([{ Config: "abc123.json", RepoTags: ["x:dev"], Layers: [] }]);
    expect(await readImageIdFromTar(tarPath)).toBe("sha256:abc123");
  });

  it("normalizes an OCI 'blobs/sha256/<hex>' Config", async () => {
    const tarPath = await makeTar([{ Config: "blobs/sha256/deadbeef", RepoTags: ["x:dev"] }]);
    expect(await readImageIdFromTar(tarPath)).toBe("sha256:deadbeef");
  });

  it("throws when manifest.json is missing", async () => {
    const stage = join(dir, "empty");
    await mkdir(stage, { recursive: true });
    await writeFile(join(stage, "only.bin"), "z", "utf8");
    const tarPath = join(dir, "bad.tar");
    await tarCreate({ file: tarPath, cwd: stage }, ["only.bin"]);
    await expect(readImageIdFromTar(tarPath)).rejects.toThrow(/no manifest\.json/);
  });

  it("throws when manifest has no Config", async () => {
    const tarPath = await makeTar([{ RepoTags: ["x:dev"] }]);
    await expect(readImageIdFromTar(tarPath)).rejects.toThrow(/no Config/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -w @journeyman/sandbox -- read-image-id-from-tar`
Expected: FAIL — `Failed to resolve import "./read-image-id-from-tar.ts"`.

- [ ] **Step 3: Write minimal implementation**

```ts
// packages/sandbox/src/backends/docker/read-image-id-from-tar.ts
import { list as tarList } from "tar";

/**
 * Read the image id of a `docker save` tar by parsing only its `manifest.json`
 * (node-tar skips the bodies of every other entry, so this never buffers layers).
 * Returns the config digest as `sha256:<hex>` — the same value `imageId(tag)`
 * reports for the loaded image, so the two can be compared directly.
 */
export async function readImageIdFromTar(tarPath: string): Promise<string> {
  let json = "";
  await tarList({
    file: tarPath,
    filter: (p: string) => p === "manifest.json" || p === "./manifest.json",
    onentry: (entry: NodeJS.ReadableStream) => {
      entry.on("data", (c: Buffer) => { json += c.toString("utf8"); });
    },
  });
  if (!json) {
    throw new Error(`tar '${tarPath}' has no manifest.json (corrupt or not a 'docker save' archive)`);
  }
  const manifest = JSON.parse(json) as Array<{ Config?: string }>;
  const config = manifest?.[0]?.Config;
  if (!config) {
    throw new Error(`tar '${tarPath}' manifest.json has no Config (unexpected docker save format)`);
  }
  const hex = config
    .replace(/^blobs\/sha256\//, "")
    .replace(/\.json$/, "")
    .replace(/^sha256:/, "");
  return `sha256:${hex}`;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -w @journeyman/sandbox -- read-image-id-from-tar`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/sandbox/src/backends/docker/read-image-id-from-tar.ts \
        packages/sandbox/src/backends/docker/read-image-id-from-tar.test.ts
git commit -m "feat(sandbox): read image id from a docker save tar

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 2: `reconcileKitImage` — load the tar when it differs from the loaded image

Replaces the existence-only `ensureKitImage` with compare-and-reload. This is the core fix: a rebuilt kit tar now actually replaces the daemon image.

**Files:**
- Modify: `packages/sandbox/src/backends/docker/ensure-kit.ts`
- Test: `packages/sandbox/src/backends/docker/ensure-kit.test.ts` (rewrite)
- Modify: `packages/sandbox/src/index.ts:30`
- Modify: `packages/sandbox/src/build/build-loop.ts:6` (import) and the `ensureKit` default
- Modify: `packages/orchestrator/src/cli-worker.ts:21` (import) and `:175` (call)

- [ ] **Step 1: Write the failing test (rewrite the file)**

```ts
// packages/sandbox/src/backends/docker/ensure-kit.test.ts
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { reconcileKitImage } from "./ensure-kit.ts";

// readImageIdFromTar is exercised in its own test; stub it here so we drive
// reconcile logic with plain values rather than building real tars.
vi.mock("./read-image-id-from-tar.ts", () => ({
  readImageIdFromTar: vi.fn(async () => "sha256:TAR"),
}));

let dir = "";
let tarPath = "";
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "kit-"));
  tarPath = join(dir, "runner-bundle.tar");
  await writeFile(tarPath, "fake-tar", "utf8");
});
afterEach(async () => { await rm(dir, { recursive: true, force: true }); });

function client(over: Partial<any> = {}) {
  return {
    imageId: vi.fn().mockResolvedValue(null),
    loadImage: vi.fn().mockResolvedValue(undefined),
    ...over,
  };
}

const NAME = "journeyman/runner-bundle:dev";

describe("reconcileKitImage", () => {
  it("skips loading when the loaded image id already matches the tar", async () => {
    const c = client({ imageId: vi.fn().mockResolvedValue("sha256:TAR") });
    await reconcileKitImage(c as any, NAME, tarPath);
    expect(c.loadImage).not.toHaveBeenCalled();
  });

  it("loads the tar when the loaded image id differs (stale)", async () => {
    const imageId = vi.fn()
      .mockResolvedValueOnce("sha256:OLD")  // before load
      .mockResolvedValueOnce("sha256:TAR"); // after load
    const c = client({ imageId });
    await reconcileKitImage(c as any, NAME, tarPath);
    expect(c.loadImage).toHaveBeenCalledWith(tarPath);
  });

  it("loads the tar when the image is absent", async () => {
    const imageId = vi.fn()
      .mockResolvedValueOnce(null)          // absent
      .mockResolvedValueOnce("sha256:TAR"); // after load
    const c = client({ imageId });
    await reconcileKitImage(c as any, NAME, tarPath);
    expect(c.loadImage).toHaveBeenCalledWith(tarPath);
  });

  it("keeps the existing image when present and no tar is on disk", async () => {
    const c = client({ imageId: vi.fn().mockResolvedValue("sha256:OLD") });
    await reconcileKitImage(c as any, NAME, join(dir, "missing.tar"));
    expect(c.loadImage).not.toHaveBeenCalled();
  });

  it("throws a clear error when image AND tar are both missing", async () => {
    const c = client({ imageId: vi.fn().mockResolvedValue(null) });
    await expect(reconcileKitImage(c as any, NAME, join(dir, "missing.tar")))
      .rejects.toThrow(/run 'npm run build:kit'/);
    expect(c.loadImage).not.toHaveBeenCalled();
  });

  it("throws when the load did not produce the expected image id", async () => {
    const imageId = vi.fn()
      .mockResolvedValueOnce("sha256:OLD")  // before
      .mockResolvedValueOnce("sha256:OLD"); // after — load didn't take
    const c = client({ imageId });
    await expect(reconcileKitImage(c as any, NAME, tarPath))
      .rejects.toThrow(/expected sha256:TAR/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -w @journeyman/sandbox -- ensure-kit`
Expected: FAIL — `reconcileKitImage` is not exported.

- [ ] **Step 3: Write minimal implementation (rewrite `ensure-kit.ts`)**

```ts
// packages/sandbox/src/backends/docker/ensure-kit.ts
import { existsSync } from "node:fs";
import type { IDockerClient } from "./docker-client.ts";
import { readImageIdFromTar } from "./read-image-id-from-tar.ts";

/**
 * Ensure a kit image (e.g. journeyman/runner-bundle:dev) on the daemon is the
 * SAME image as the tar on disk. Loads the tar from `docker save` when the image
 * is absent OR its content id differs from the tar's — never pulls, never builds.
 *
 * This is the freshness fix: kit images use a fixed mutable tag (`:dev`), so an
 * existence-only check would keep a stale image forever. Comparing image ids
 * makes a rebuilt-and-re-saved tar actually replace the daemon image.
 */
export async function reconcileKitImage(
  client: IDockerClient,
  imageName: string,
  tarPath: string,
  log: (line: string) => void = () => {},
): Promise<void> {
  const loadedId = await client.imageId(imageName);
  const tarExists = existsSync(tarPath);

  if (!tarExists) {
    if (loadedId) return; // present, nothing to compare against — keep it
    throw new Error(
      `kit image '${imageName}' not found on the daemon and no tar at '${tarPath}' — run 'npm run build:kit'`,
    );
  }

  const tarId = await readImageIdFromTar(tarPath);
  if (loadedId === tarId) return; // up to date

  log(`loading kit image ${imageName} from ${tarPath} (was ${loadedId ?? "absent"}, tar ${tarId})`);
  await client.loadImage(tarPath);

  const after = await client.imageId(imageName);
  if (after !== tarId) {
    throw new Error(
      `loaded '${tarPath}' but '${imageName}' is ${after ?? "absent"} (expected ${tarId}; tar/arch mismatch?)`,
    );
  }
  log(`kit image ${imageName} loaded (${tarId})`);
}
```

- [ ] **Step 4: Update the three call sites + the export**

In `packages/sandbox/src/index.ts:30`, change:

```ts
export { reconcileKitImage } from "./backends/docker/ensure-kit.ts";
```

In `packages/sandbox/src/build/build-loop.ts` — update the import line (currently `import { ensureKitImage } from "../backends/docker/ensure-kit.ts";`) to:

```ts
import { reconcileKitImage } from "../backends/docker/ensure-kit.ts";
```

and the `ensureKit` seam default (currently `const ensureKit = deps.ensureKit ?? ensureKitImage;`):

```ts
  const ensureKit = deps.ensureKit ?? reconcileKitImage;
```

In `packages/orchestrator/src/cli-worker.ts:21`, change the import from `ensureKitImage` to `reconcileKitImage`, and at `:175` change the call:

```ts
        if (!preBuilt) await reconcileKitImage(dockerClient, RUNNER_IMAGE, RUNNER_BASE_TAR);
```

- [ ] **Step 5: Run the affected suites + typecheck**

Run: `npm test -w @journeyman/sandbox -- ensure-kit build-loop && npm run typecheck`
Expected: PASS — `ensure-kit` (6) and `build-loop` (5) green; typecheck clean (no remaining `ensureKitImage` references).

- [ ] **Step 6: Commit**

```bash
git add packages/sandbox/src/backends/docker/ensure-kit.ts \
        packages/sandbox/src/backends/docker/ensure-kit.test.ts \
        packages/sandbox/src/index.ts \
        packages/sandbox/src/build/build-loop.ts \
        packages/orchestrator/src/cli-worker.ts
git commit -m "feat(sandbox): reconcile kit images by content id, not existence

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 3: `IDockerClient.pullImage` + `buildImage({ pull })`

Adds the registry-pull capability the base-ref freshness path needs, plus a `--pull` flag for dockerfile builds.

**Files:**
- Modify: `packages/sandbox/src/backends/docker/docker-client.ts`
- Test: `packages/sandbox/src/backends/docker/docker-client.test.ts`

- [ ] **Step 1: Write the failing test (append to the existing suite)**

```ts
// packages/sandbox/src/backends/docker/docker-client.test.ts — add these cases.
// Adjust the import line if the file doesn't already import makeDockerClient.
import { describe, it, expect, vi } from "vitest";
import { makeDockerClient } from "./docker-client.ts";

describe("DockerodeClient.pullImage", () => {
  it("pulls the ref and waits for completion via followProgress", async () => {
    const followProgress = vi.fn((_stream, cb) => cb(null, []));
    const pull = vi.fn().mockResolvedValue("stream");
    const fake = { pull, modem: { followProgress } } as any;
    const client = makeDockerClient({ kind: "injected", docker: fake } as any);
    await client.pullImage("node:20");
    expect(pull).toHaveBeenCalledWith("node:20");
    expect(followProgress).toHaveBeenCalled();
  });

  it("rejects when the pull stream reports an error event", async () => {
    const followProgress = vi.fn((_stream, cb) => cb(null, [{ error: "denied" }]));
    const fake = { pull: vi.fn().mockResolvedValue("s"), modem: { followProgress } } as any;
    const client = makeDockerClient({ kind: "injected", docker: fake } as any);
    await expect(client.pullImage("private/x:1")).rejects.toThrow(/denied/);
  });
});

describe("DockerodeClient.buildImage pull flag", () => {
  it("forwards pull:true into the dockerode build options", async () => {
    const buildImage = vi.fn().mockResolvedValue("stream");
    const followProgress = vi.fn((_stream, cb) => cb(null, []));
    const fake = { buildImage, modem: { followProgress } } as any;
    const client = makeDockerClient({ kind: "injected", docker: fake } as any);
    await client.buildImage({ contextDir: "/c", dockerfileName: "Dockerfile", tag: "t:1", pull: true });
    expect(buildImage).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ pull: true }),
    );
  });
});
```

> NOTE: if `makeDockerClient` does not already support a `{ kind: "injected", docker }` test seam, add one: a branch in `makeDockerClient` that, when `conn.kind === "injected"`, returns `new DockerodeClient(conn.docker)`. Keep it un-exported behaviour gated on that kind so production paths are unaffected. If the existing test file uses a different injection pattern, follow that pattern instead and keep these assertions.

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -w @journeyman/sandbox -- docker-client`
Expected: FAIL — `client.pullImage is not a function` / `pull` not forwarded.

- [ ] **Step 3: Implement on the interface + class**

In `packages/sandbox/src/backends/docker/docker-client.ts`, add to the `IDockerClient` interface (next to `buildImage`/`loadImage`):

```ts
  /** Pull `ref` from its registry. Best-effort: callers decide how to handle failure. */
  pullImage(ref: string): Promise<void>;
```

Change the `buildImage` signature in the interface to accept an optional `pull`:

```ts
  buildImage(o: { contextDir: string; dockerfileName: string; tag: string; pull?: boolean }): Promise<void>;
```

In `DockerodeClient`, add `pullImage` (mirrors the `loadImage` error-scanning pattern):

```ts
  async pullImage(ref: string): Promise<void> {
    const stream = await this.docker.pull(ref);
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

In `DockerodeClient.buildImage`, thread the flag into the dockerode options:

```ts
  async buildImage(o: { contextDir: string; dockerfileName: string; tag: string; pull?: boolean }): Promise<void> {
    const stream = await this.docker.buildImage(
      { context: o.contextDir, src: [o.dockerfileName] },
      { t: o.tag, dockerfile: o.dockerfileName, ...(o.pull ? { pull: true } : {}) },
    );
    // ...followProgress block unchanged...
  }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -w @journeyman/sandbox -- docker-client && npm run typecheck`
Expected: PASS; typecheck clean.

- [ ] **Step 5: Commit**

```bash
git add packages/sandbox/src/backends/docker/docker-client.ts \
        packages/sandbox/src/backends/docker/docker-client.test.ts
git commit -m "feat(sandbox): add pullImage + buildImage pull flag to docker client

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 4: Fold base-ref id into the fingerprint via `resolveBuildInputs`

Makes a moved base ref (and an already-handled moved kit) change the box fingerprint, and centralizes fingerprint computation so the builder and the freshness gate agree.

**Files:**
- Modify: `packages/sandbox/src/backends/docker/recipe.ts`
- Test: `packages/sandbox/src/backends/docker/recipe.test.ts`
- Create: `packages/sandbox/src/backends/docker/resolve-build-inputs.ts`
- Test: `packages/sandbox/src/backends/docker/resolve-build-inputs.test.ts`
- Modify: `packages/sandbox/src/backends/docker/build-image.ts`
- Modify: `packages/sandbox/src/backends/docker/build-image.test.ts`

- [ ] **Step 1: Write the failing fingerprint test (append to `recipe.test.ts`)**

```ts
// append inside the existing describe("computeFingerprint", ...) block:
  it("changes when the base-ref id changes", () => {
    expect(computeFingerprint("FROM x\n", "sha256:abc", "sha256:ref1"))
      .not.toBe(computeFingerprint("FROM x\n", "sha256:abc", "sha256:ref2"));
  });
  it("is unchanged for the legacy 2-arg call (baseRefId defaults to empty)", () => {
    expect(computeFingerprint("FROM x\n", "sha256:abc"))
      .toBe(computeFingerprint("FROM x\n", "sha256:abc", ""));
  });
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm test -w @journeyman/sandbox -- recipe`
Expected: FAIL — `computeFingerprint` takes 2 args.

- [ ] **Step 3: Add `baseRefId` to `computeFingerprint`**

In `packages/sandbox/src/backends/docker/recipe.ts`:

```ts
/** Stable 16-hex fingerprint of (recipe + kit/bundle digest + base-ref digest). */
export function computeFingerprint(
  effectiveRecipe: string,
  bundleId: string,
  baseRefId = "",
): string {
  return createHash("sha256")
    .update(effectiveRecipe)
    .update("\0")
    .update(bundleId)
    .update("\0")
    .update(baseRefId)
    .digest("hex")
    .slice(0, 16);
}
```

- [ ] **Step 4: Run to verify recipe tests pass**

Run: `npm test -w @journeyman/sandbox -- recipe`
Expected: PASS (existing 2-arg tests still green; new cases green).

- [ ] **Step 5: Write the failing `resolveBuildInputs` test**

```ts
// packages/sandbox/src/backends/docker/resolve-build-inputs.test.ts
import { describe, it, expect, vi } from "vitest";
import type { IDockerClient } from "./docker-client.ts";
import { resolveBuildInputs } from "./resolve-build-inputs.ts";

const BUNDLE = "journeyman/runner-bundle:dev";

function client(over: Partial<any> = {}) {
  return {
    imageId: vi.fn(async (tag: string) => (tag === BUNDLE ? "sha256:bundle" : "sha256:ref")),
    pullImage: vi.fn().mockResolvedValue(undefined),
    ...over,
  } as unknown as IDockerClient & { imageId: any; pullImage: any };
}

describe("resolveBuildInputs", () => {
  it("pulls a mutable ref and folds its id into the fingerprint", async () => {
    const c = client();
    const r = await resolveBuildInputs({ image: { kind: "ref", imageRef: "node:20" }, client: c, bundleRef: BUNDLE });
    expect(c.pullImage).toHaveBeenCalledWith("node:20");
    expect(r.baseRefId).toBe("sha256:ref");
    expect(r.imageRef).toMatch(/^journeyman\/jm-built:[0-9a-f]{16}$/);
    expect(r.dockerfilePull).toBe(false);
  });

  it("does NOT pull a digest-pinned ref", async () => {
    const c = client();
    await resolveBuildInputs({ image: { kind: "ref", imageRef: "node@sha256:deadbeef" }, client: c, bundleRef: BUNDLE });
    expect(c.pullImage).not.toHaveBeenCalled();
  });

  it("falls back to the local image when the pull fails", async () => {
    const c = client({ pullImage: vi.fn().mockRejectedValue(new Error("offline")) });
    const r = await resolveBuildInputs({ image: { kind: "ref", imageRef: "node:20" }, client: c, bundleRef: BUNDLE });
    expect(r.baseRefId).toBe("sha256:ref"); // still resolved from local imageId
  });

  it("for a dockerfile recipe: no pull, empty baseRefId, dockerfilePull=true", async () => {
    const c = client();
    const r = await resolveBuildInputs({ image: { kind: "dockerfile", content: "FROM python:3.12\n" }, client: c, bundleRef: BUNDLE });
    expect(c.pullImage).not.toHaveBeenCalled();
    expect(r.baseRefId).toBe("");
    expect(r.dockerfilePull).toBe(true);
  });

  it("throws for an empty image", async () => {
    const c = client();
    await expect(resolveBuildInputs({ image: undefined, client: c, bundleRef: BUNDLE }))
      .rejects.toThrow(/no image recipe/i);
  });
});
```

- [ ] **Step 6: Run to verify it fails**

Run: `npm test -w @journeyman/sandbox -- resolve-build-inputs`
Expected: FAIL — module not found.

- [ ] **Step 7: Implement `resolveBuildInputs`**

```ts
// packages/sandbox/src/backends/docker/resolve-build-inputs.ts
import type { IDockerClient } from "./docker-client.ts";
import { buildEffectiveRecipe, computeFingerprint, type ImageConfig } from "./recipe.ts";

export interface ResolveBuildInputsArgs {
  image: ImageConfig;
  client: IDockerClient;
  bundleRef: string;
  tagPrefix?: string;
  log?: (line: string) => void;
}

export interface BuildInputs {
  effectiveRecipe: string;
  bundleId: string;
  baseRefId: string;
  fingerprint: string;
  imageRef: string;
  /** Pass --pull to the build (dockerfile recipes only; refs are pulled explicitly). */
  dockerfilePull: boolean;
}

/** True for an already-digest-pinned ref (`name@sha256:...`) — cannot move, so never pulled. */
function isPinned(ref: string): boolean {
  return /@sha256:[0-9a-f]{64}$/i.test(ref.trim());
}

/**
 * Resolve everything a box build depends on RIGHT NOW: the grafted recipe, the
 * kit (bundle) image id, and the base-ref id (best-effort pulled for mutable
 * refs). The fingerprint folds all three, so a moved kit OR a moved base ⇒ a new
 * tag ⇒ a rebuild. Shared by the builder and the per-run freshness gate.
 */
export async function resolveBuildInputs(args: ResolveBuildInputsArgs): Promise<BuildInputs> {
  const log = args.log ?? (() => {});
  const effectiveRecipe = buildEffectiveRecipe(args.image, args.bundleRef);
  if (effectiveRecipe === null) throw new Error("no image recipe to build (empty image)");

  const bundleId = (await args.client.imageId(args.bundleRef)) ?? "";

  let baseRefId = "";
  let dockerfilePull = false;
  if (args.image?.kind === "ref" && args.image.imageRef?.trim()) {
    const ref = args.image.imageRef.trim();
    if (!isPinned(ref)) {
      try {
        await args.client.pullImage(ref);
      } catch (err) {
        log(`warning: could not pull '${ref}' (${(err as Error).message}); using local copy`);
      }
    }
    baseRefId = (await args.client.imageId(ref)) ?? "";
  } else if (args.image?.kind === "dockerfile") {
    dockerfilePull = true;
  }

  const fingerprint = computeFingerprint(effectiveRecipe, bundleId, baseRefId);
  const imageRef = `${args.tagPrefix ?? "journeyman/jm-built"}:${fingerprint}`;
  return { effectiveRecipe, bundleId, baseRefId, fingerprint, imageRef, dockerfilePull };
}
```

- [ ] **Step 8: Run to verify it passes**

Run: `npm test -w @journeyman/sandbox -- resolve-build-inputs`
Expected: PASS (5 tests).

- [ ] **Step 9: Refactor `buildBoxImage` to use `resolveBuildInputs`**

In `packages/sandbox/src/backends/docker/build-image.ts`, replace the body of `buildBoxImage` (keep the exported signature and `BuildBoxImageResult`):

```ts
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { IDockerClient } from "./docker-client.ts";
import { type ImageConfig } from "./recipe.ts";
import { resolveBuildInputs } from "./resolve-build-inputs.ts";

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

export async function buildBoxImage(deps: BuildBoxImageDeps): Promise<BuildBoxImageResult> {
  const inputs = await resolveBuildInputs({
    image: deps.image,
    client: deps.client,
    bundleRef: deps.bundleRef,
    ...(deps.tagPrefix ? { tagPrefix: deps.tagPrefix } : {}),
  });

  if (await deps.client.imageExists(inputs.imageRef)) {
    return { imageRef: inputs.imageRef, fingerprint: inputs.fingerprint };
  }

  const dir = await mkdtemp(join(tmpdir(), "jm-build-"));
  try {
    await writeFile(join(dir, "Dockerfile"), inputs.effectiveRecipe, "utf8");
    await deps.client.buildImage({
      contextDir: dir,
      dockerfileName: "Dockerfile",
      tag: inputs.imageRef,
      ...(inputs.dockerfilePull ? { pull: true } : {}),
    });
    if (!(await deps.client.imageExists(inputs.imageRef))) {
      throw new Error(`build reported success but image ${inputs.imageRef} is absent`);
    }
    return { imageRef: inputs.imageRef, fingerprint: inputs.fingerprint };
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

- [ ] **Step 10: Update `build-image.test.ts` fake clients to include `pullImage`**

The existing fakes lack `pullImage`, which `resolveBuildInputs` calls for `kind:ref`. In `packages/sandbox/src/backends/docker/build-image.test.ts`, add `async pullImage() {}` to the `fakeClient` factory's returned object **and** to the inline client in the "build silently succeeds" test:

```ts
  const client = {
    async imageExists(tag: string) { return exists || built.includes(tag); },
    async imageId() { return bundleId; },
    async pullImage() { /* no-op in tests */ },
    async buildImage(o: { tag: string }) { built.push(o.tag); },
  } as unknown as IDockerClient;
```

(The `imageId()` fake returns `bundleId` for every tag, so `baseRefId === bundleId`; that's fine — the tests assert tag *shape* and *determinism*, both of which still hold.)

- [ ] **Step 11: Run the full sandbox suite + typecheck**

Run: `npm test -w @journeyman/sandbox -- build-image recipe resolve-build-inputs && npm run typecheck`
Expected: PASS across all three; typecheck clean.

- [ ] **Step 12: Commit**

```bash
git add packages/sandbox/src/backends/docker/recipe.ts \
        packages/sandbox/src/backends/docker/recipe.test.ts \
        packages/sandbox/src/backends/docker/resolve-build-inputs.ts \
        packages/sandbox/src/backends/docker/resolve-build-inputs.test.ts \
        packages/sandbox/src/backends/docker/build-image.ts \
        packages/sandbox/src/backends/docker/build-image.test.ts
git commit -m "feat(sandbox): fold base-ref id into box fingerprint via resolveBuildInputs

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 5: Per-run freshness gate in `ensureWorkspace`

A `ready` box is re-verified at run time: recompute the expected fingerprint and, on drift, re-enqueue a build and throw the existing retryable error so the run waits for the fresh image.

**Files:**
- Modify: `packages/core/src/types/execution-environment.types.ts` (`ResolvedSandbox.imageFingerprint`)
- Modify: `packages/sandbox/src/resolver.ts` (surface `imageFingerprint`)
- Modify: `packages/orchestrator/src/sandbox/ensure-workspace.ts`
- Test: `packages/orchestrator/src/sandbox/ensure-workspace.test.ts`
- Modify: `packages/orchestrator/src/cli-worker.ts` (wire `verifyImageFresh`; pass `imageFingerprint`)

- [ ] **Step 1: Surface `imageFingerprint` through the resolved type + resolver**

In `packages/core/src/types/execution-environment.types.ts`, in the `ResolvedSandbox` interface (near `imageState`/`imageRef` around line 103):

```ts
  imageFingerprint?: string | null;
```

In `packages/sandbox/src/resolver.ts`, add to the `toResolved` return object (next to `imageState`):

```ts
    imageFingerprint: w.imageFingerprint,
```

- [ ] **Step 2: Write the failing gate test (append to the run-gating describe block)**

```ts
// packages/orchestrator/src/sandbox/ensure-workspace.test.ts — add to
// describe("ensureWorkspace run-gating (Spec B managed images)", ...)

  it("re-verifies a ready image and proceeds when fresh", async () => {
    const verifyImageFresh = vi.fn().mockResolvedValue({ fresh: true });
    const deps = baseDeps({
      type: "docker",
      config: { image: { kind: "ref", imageRef: "node:20" } },
      imageState: "ready",
      imageRef: "journeyman/jm-built:fp",
      imageFingerprint: "fp",
    });
    (deps as any).verifyImageFresh = verifyImageFresh;
    await ensureWorkspace(deps as any, args);
    expect(verifyImageFresh).toHaveBeenCalled();
    expect(deps.provisionDocker).toHaveBeenCalledWith("run-1",
      expect.objectContaining({ config: expect.objectContaining({ __imageRef: "journeyman/jm-built:fp" }) }));
  });

  it("re-enqueues + retries when the ready image drifted (stale)", async () => {
    const verifyImageFresh = vi.fn().mockResolvedValue({ fresh: false, reason: "image drift" });
    const deps = baseDeps({
      type: "docker",
      config: { image: { kind: "ref", imageRef: "node:20" } },
      imageState: "ready",
      imageRef: "journeyman/jm-built:fp",
      imageFingerprint: "fp",
    });
    (deps as any).verifyImageFresh = verifyImageFresh;
    await expect(ensureWorkspace(deps as any, args)).rejects.toMatchObject({ name: "ImageNotReadyError" });
    expect(deps.onImagePending).toHaveBeenCalledWith("t1");
    expect(deps.provisionDocker).not.toHaveBeenCalled();
  });
```

> NOTE: confirm `baseDeps` accepts and forwards `imageFingerprint` into the `resolveSandbox` mock result. If it doesn't, add `imageFingerprint` to the object `resolveSandbox` resolves (mirroring how `imageRef`/`imageError` are already threaded). The `args` fixture uses `runId: "run-1"` and `sandboxId: "t1"` — match whatever the existing fixture uses; adjust the assertions accordingly if the ids differ.

- [ ] **Step 3: Run to verify it fails**

Run: `npm test -w @journeyman/orchestrator -- ensure-workspace`
Expected: FAIL — `verifyImageFresh` is never called (fresh case provisions without it; stale case provisions instead of throwing).

- [ ] **Step 4: Implement the gate**

In `packages/orchestrator/src/sandbox/ensure-workspace.ts`:

Add to the `resolveSandbox` return shape (the inline type around lines 40–46):

```ts
    imageFingerprint?: string | null;
```

Add the optional dep to `EnsureWorkspaceDeps` (next to `onImagePending`):

```ts
  /** Re-verify a ready image is still the latest; on drift the gate re-enqueues a build. Optional. */
  verifyImageFresh?(args: {
    sandboxId: string;
    config: Record<string, unknown>;
    storedFingerprint: string;
    storedImageRef: string;
  }): Promise<{ fresh: boolean; reason?: string }>;
```

In the run-gating block, replace the final fall-through (the `// ready + imageRef → fall through` line and the `__imageRef` assignment) with:

```ts
      // ready + imageRef: re-verify it's still the latest before using it.
      if (args.sandboxId && deps.verifyImageFresh) {
        const v = await deps.verifyImageFresh({
          sandboxId: args.sandboxId,
          config: worker.config,
          storedFingerprint: worker.imageFingerprint ?? "",
          storedImageRef: worker.imageRef,
        });
        if (!v.fresh) {
          log("Environment changed; rebuilding…");
          if (deps.onImagePending) await deps.onImagePending(args.sandboxId);
          throw new ImageNotReadyError(v.reason ?? "sandbox image is stale; rebuilding");
        }
      }
      (worker.config as Record<string, unknown>)["__imageRef"] = worker.imageRef;
```

- [ ] **Step 5: Run to verify it passes**

Run: `npm test -w @journeyman/orchestrator -- ensure-workspace`
Expected: PASS — fresh path provisions; stale path throws `ImageNotReadyError` + calls `onImagePending`; the existing gating tests (which don't pass `verifyImageFresh`) still pass because the dep is optional.

- [ ] **Step 6: Wire `verifyImageFresh` in `cli-worker.ts`**

Add `resolveBuildInputs` to the `@journeyman/sandbox` import in `cli-worker.ts`. In the `ensureWs` deps object (next to `onImagePending`), add:

```ts
      verifyImageFresh: async ({ config, storedFingerprint, storedImageRef }) => {
        const connection = (config as Record<string, unknown>)["connection"] ?? { kind: "local" };
        const client = makeDockerClient(connection as Parameters<typeof makeDockerClient>[0]);
        // Refresh the kit (bundle) first so its image id is current before we
        // recompute the expected fingerprint.
        await reconcileKitImage(client, RUNNER_BUNDLE, RUNNER_BUNDLE_TAR);
        const inputs = await resolveBuildInputs({
          image: (config as Record<string, unknown>)["image"] as never,
          client,
          bundleRef: RUNNER_BUNDLE,
        });
        const present = await client.imageExists(storedImageRef);
        const fresh = present && inputs.fingerprint === storedFingerprint;
        return {
          fresh,
          ...(fresh ? {} : { reason: `image drift: expected ${inputs.fingerprint}, have ${storedFingerprint || "none"}${present ? "" : " (image pruned)"}` }),
        };
      },
```

Also update the `resolveSandbox` dep mapping in `cli-worker.ts` to pass the fingerprint through:

```ts
            imageFingerprint: w.imageFingerprint,
```

- [ ] **Step 7: Typecheck + targeted tests**

Run: `npm run typecheck && npm test -w @journeyman/orchestrator -- ensure-workspace && npm test -w @journeyman/sandbox -- resolver`
Expected: PASS; typecheck clean.

- [ ] **Step 8: Commit**

```bash
git add packages/core/src/types/execution-environment.types.ts \
        packages/sandbox/src/resolver.ts \
        packages/orchestrator/src/sandbox/ensure-workspace.ts \
        packages/orchestrator/src/sandbox/ensure-workspace.test.ts \
        packages/orchestrator/src/cli-worker.ts
git commit -m "feat(orchestrator): re-verify box freshness per run, rebuild on drift

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 6: Prune orphaned `jm-built:*` images

Each rebuild leaves the previous `jm-built:<oldfp>` tag behind. A focused pruner removes built-image tags not referenced by any live sandbox, so disk doesn't grow as fingerprints churn. (Implemented as its own module rather than folded into `SandboxInstanceReaper`, whose deps are instance/container-specific — this keeps each file single-responsibility.)

**Files:**
- Create: `packages/sandbox/src/backends/docker/prune-built-images.ts`
- Test: `packages/sandbox/src/backends/docker/prune-built-images.test.ts`
- Modify: `packages/sandbox/src/index.ts` (export)
- Modify: `packages/orchestrator/src/cli-worker.ts` (optional periodic call — see Step 5)

First add the listing/removal primitives the pruner needs to `IDockerClient`.

- [ ] **Step 1: Write the failing test**

```ts
// packages/sandbox/src/backends/docker/prune-built-images.test.ts
import { describe, it, expect, vi } from "vitest";
import type { IDockerClient } from "./docker-client.ts";
import { pruneBuiltImages } from "./prune-built-images.ts";

function client(tags: string[], over: Partial<any> = {}) {
  return {
    listImageTags: vi.fn().mockResolvedValue(tags),
    removeImage: vi.fn().mockResolvedValue(undefined),
    ...over,
  } as unknown as IDockerClient & { listImageTags: any; removeImage: any };
}

describe("pruneBuiltImages", () => {
  it("removes jm-built tags not in the keep set", async () => {
    const c = client([
      "journeyman/jm-built:keep1",
      "journeyman/jm-built:old1",
      "journeyman/jm-built:old2",
      "node:20", // not a jm-built tag — never touched
    ]);
    const removed = await pruneBuiltImages(c as any, new Set(["journeyman/jm-built:keep1"]));
    expect(removed).toEqual(["journeyman/jm-built:old1", "journeyman/jm-built:old2"]);
    expect(c.removeImage).toHaveBeenCalledTimes(2);
    expect(c.removeImage).not.toHaveBeenCalledWith("node:20");
  });

  it("never removes a kept image and ignores non-jm-built tags", async () => {
    const c = client(["journeyman/jm-built:keep1", "journeyman/runner-base:dev"]);
    const removed = await pruneBuiltImages(c as any, new Set(["journeyman/jm-built:keep1"]));
    expect(removed).toEqual([]);
    expect(c.removeImage).not.toHaveBeenCalled();
  });

  it("swallows per-image removal errors (image in use) and continues", async () => {
    const removeImage = vi.fn()
      .mockRejectedValueOnce(new Error("in use"))
      .mockResolvedValueOnce(undefined);
    const c = client(["journeyman/jm-built:a", "journeyman/jm-built:b"], { removeImage });
    const removed = await pruneBuiltImages(c as any, new Set());
    expect(removed).toEqual(["journeyman/jm-built:b"]);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm test -w @journeyman/sandbox -- prune-built-images`
Expected: FAIL — module not found.

- [ ] **Step 3: Add `listImageTags` + `removeImage` to the client**

In `packages/sandbox/src/backends/docker/docker-client.ts`, add to `IDockerClient`:

```ts
  /** All repo:tag strings present on the daemon (skips `<none>` dangling tags). */
  listImageTags(): Promise<string[]>;
  /** Remove an image by tag; rejects if the daemon refuses (e.g. in use). */
  removeImage(tag: string): Promise<void>;
```

Implement in `DockerodeClient`:

```ts
  async listImageTags(): Promise<string[]> {
    const images = await this.docker.listImages();
    const tags: string[] = [];
    for (const img of images) {
      for (const t of img.RepoTags ?? []) {
        if (t && t !== "<none>:<none>") tags.push(t);
      }
    }
    return tags;
  }

  async removeImage(tag: string): Promise<void> {
    await this.docker.getImage(tag).remove();
  }
```

- [ ] **Step 4: Implement `pruneBuiltImages`**

```ts
// packages/sandbox/src/backends/docker/prune-built-images.ts
import type { IDockerClient } from "./docker-client.ts";

const BUILT_PREFIX = "journeyman/jm-built:";

/**
 * Remove `journeyman/jm-built:*` image tags that are NOT in `keep` — the fingerprint
 * tags of boxes still referenced by a ready sandbox. Other repos (node:20, the kit
 * images) are never touched. Per-image removal failures (image in use by a live
 * container) are swallowed so one stuck image can't block the rest. Returns the
 * tags actually removed.
 */
export async function pruneBuiltImages(
  client: IDockerClient,
  keep: Set<string>,
  log: (line: string) => void = () => {},
): Promise<string[]> {
  const tags = await client.listImageTags();
  const removed: string[] = [];
  for (const tag of tags) {
    if (!tag.startsWith(BUILT_PREFIX)) continue;
    if (keep.has(tag)) continue;
    try {
      await client.removeImage(tag);
      removed.push(tag);
    } catch (err) {
      log(`could not remove ${tag} (${(err as Error).message}); leaving for next sweep`);
    }
  }
  return removed;
}
```

- [ ] **Step 5: Export + optional wiring**

In `packages/sandbox/src/index.ts`, add:

```ts
export { pruneBuiltImages } from "./backends/docker/prune-built-images.ts";
```

Optional (recommended) wiring in `cli-worker.ts`: after the build loop's drain in each tick is out of scope to change, so instead add a low-frequency prune to the build loop's owner process. Add a guarded interval near where `startBuildLoop` is set up:

```ts
// Periodically prune orphaned jm-built images (keep set = ready boxes' refs).
const stopPrune = pool
  ? (() => {
      const timer = setInterval(() => {
        void (async () => {
          try {
            const refs = await listReadyImageRefs(pool!); // SELECT image_ref FROM jm_sandboxes WHERE image_state='ready' AND image_ref IS NOT NULL
            const client = makeDockerClient({ kind: "local" });
            const removed = await pruneBuiltImages(client, new Set(refs), (l) => log.info({ line: l }, "prune"));
            if (removed.length) log.info({ removed }, "pruned orphaned built images");
          } catch (err) {
            log.warn({ err: String(err) }, "image prune sweep failed");
          }
        })();
      }, 600_000); // every 10 min
      if ("unref" in timer) (timer as { unref: () => void }).unref();
      return () => clearInterval(timer);
    })()
  : () => {};
```

Add a small helper near the other DB helpers (or in `@journeyman/sandbox` `db.ts`) named `listReadyImageRefs(db): Promise<string[]>` that runs `SELECT image_ref FROM jm_sandboxes WHERE type='docker' AND image_state='ready' AND image_ref IS NOT NULL` and returns the column. Wire `stopPrune()` into the existing `SIGINT`/`SIGTERM` shutdown alongside `stopBuildLoop()`.

> NOTE: the prune uses `{ kind: "local" }` for the daemon connection — correct for the single-daemon default. If your deployment targets remote daemons per sandbox, restrict the keep-set/prune to the local daemon only, or skip this wiring step and run prune as a manual/cron tool. Confirm against how `connection` is configured in your environment before enabling.

- [ ] **Step 6: Run to verify it passes + typecheck**

Run: `npm test -w @journeyman/sandbox -- prune-built-images docker-client && npm run typecheck`
Expected: PASS; typecheck clean.

- [ ] **Step 7: Commit**

```bash
git add packages/sandbox/src/backends/docker/prune-built-images.ts \
        packages/sandbox/src/backends/docker/prune-built-images.test.ts \
        packages/sandbox/src/backends/docker/docker-client.ts \
        packages/sandbox/src/index.ts \
        packages/orchestrator/src/cli-worker.ts
git commit -m "feat(sandbox): prune orphaned jm-built images on a low-frequency sweep

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Final verification

- [ ] **Run the full check suite**

Run: `npm run check`
Expected: typecheck + import-boundary check both pass.

- [ ] **Run the affected workspace tests**

Run: `npm test -w @journeyman/sandbox && npm test -w @journeyman/orchestrator`
Expected: PASS. Note the project's known baseline of pre-existing failures (see memory `deps-campaign-test-baseline`): the gate is *no new regressions*, not zero failures. Compare against that baseline; any new failure must be triaged.

---

## Notes & limitations (carried from the spec)

- **Dockerfile recipes:** built with `--pull` (`dockerfilePull`), so base layers stay fresh, but an *upstream-only* `FROM` move does not change the fingerprint and so won't auto-rebuild. A dockerfile box still rebuilds on recipe or kit change. This is the accepted trade-off (option a) — parsing arbitrary/multistage `FROM` lines was rejected.
- **First run after a refresh is gated:** on drift, the gate throws the retryable `ImageNotReadyError`; Conductor backs off while the build loop rebuilds. Correctness over latency, by design.
- **Best-effort ref pull:** pull failure (offline/private) logs a warning and falls back to the local copy; it never fails the run.
- **`docker load` is safe under live runs:** it retags `:dev` to the new image id; already-running containers keep their pinned image. Only new runs pick up the change.
