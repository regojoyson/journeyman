# Workers Dockerfile Auto-Wrap Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a Docker worker define its image via a **Dockerfile** (not just a prebuilt ref). Journeyman auto-wraps the user's Dockerfile with the runner bundle + baseline tools, builds and caches the image by content hash, and uses the built ref to provision. Implements spec §8's Dockerfile path (deferred in Plan 4, which threw "not supported").

**Architecture:** A relocatable **`journeyman/runner-bundle`** image carries `/opt/journeyman` (a self-contained Node + the bundled `coding-cli` runner + a `journeyman-runner` launcher). `wrapDockerfile(userContent, bundleRef)` appends a baseline-tools install + `COPY --from=<bundle> /opt/journeyman /opt/journeyman` + `ENV PATH`. `buildDockerfileImage()` hashes the effective Dockerfile, reuses a cached image if present, else builds and tags it. The provisioner resolves a dockerfile worker to a built image ref before `provision`.

**Scope (v1):** **glibc, host-arch** bases (Debian/Ubuntu family — the base of official Java/.NET/Python/Node images). Baseline tools (`git`/`ssh`/`certs`) are installed via `apt` in the wrap (best-effort; `|| true` so non-apt bases still build, with git resolved from the base if present). **musl/Alpine + multi-arch are a documented follow-up** (additional bundle flavors + libc detection).

**Tech Stack:** TypeScript, `node:child_process`/`node:crypto`/`node:fs`, Docker, vitest. Builds on Plan 4 (`DockerCommandRunner`, `DockerExecutionEnvironment`, `dockerSpecFromConfig`) and Plan 5/6 (provisioner in `composition.ts`).

**Depends on:** Plan 2 (runner + `cli.ts`), Plan 4 (docker backend), Plan 5/6 (provisioner wiring).

---

## File Structure

- `docker/runner-bundle.Dockerfile` — **Create.** Relocatable `/opt/journeyman` bundle.
- `scripts/build-runner-bundle.sh` — **Create.** Build helper.
- `packages/workers/src/backends/docker/dockerfile-wrap.ts` — **Create.** `wrapDockerfile` (pure).
- `packages/workers/src/backends/docker/dockerfile-wrap.test.ts` — **Create.**
- `packages/workers/src/backends/docker/build-image.ts` — **Create.** `buildDockerfileImage` (hash + cache + build).
- `packages/workers/src/backends/docker/build-image.test.ts` — **Create.**
- `packages/workers/src/backends/docker/docker-backend.ts` — **Modify.** Add async `resolveDockerSpec` (ref or built dockerfile); keep `dockerSpecFromConfig` for the ref path.
- `packages/workers/src/backends/docker/docker-integration.test.ts` — **Modify.** Add a gated build-from-Dockerfile case.
- `packages/workers/src/index.ts` — **Modify.** Export the new surface.
- `packages/api-server/src/composition.ts` — **Modify.** Provisioner uses `resolveDockerSpec` (so dockerfile workers build + run).

---

## Task 1: `wrapDockerfile` (pure)

**Files:**
- Create: `packages/workers/src/backends/docker/dockerfile-wrap.ts`
- Test: `packages/workers/src/backends/docker/dockerfile-wrap.test.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/workers/src/backends/docker/dockerfile-wrap.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { wrapDockerfile } from "./dockerfile-wrap.ts";

describe("wrapDockerfile", () => {
  const out = wrapDockerfile("FROM eclipse-temurin:21\nRUN echo hi", "journeyman/runner-bundle:dev");

  it("keeps the user's content first", () => {
    expect(out.startsWith("FROM eclipse-temurin:21\nRUN echo hi")).toBe(true);
  });

  it("appends the runner bundle COPY and PATH", () => {
    expect(out).toContain("COPY --from=journeyman/runner-bundle:dev /opt/journeyman /opt/journeyman");
    expect(out).toContain("ENV PATH=/opt/journeyman/bin:$PATH");
  });

  it("appends a best-effort baseline-tools install", () => {
    expect(out).toMatch(/apt-get install -y[^\n]*git/);
    expect(out).toContain("|| true");
  });

  it("does not inject when the base is already the runner base", () => {
    const skipped = wrapDockerfile("FROM journeyman/runner-base:dev\nRUN x", "journeyman/runner-bundle:dev");
    expect(skipped).not.toContain("COPY --from=journeyman/runner-bundle");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run packages/workers/src/backends/docker/dockerfile-wrap.test.ts`
Expected: FAIL — cannot resolve `./dockerfile-wrap.ts`.

- [ ] **Step 3: Write the implementation**

Create `packages/workers/src/backends/docker/dockerfile-wrap.ts`:

```typescript
/**
 * Append the Journeyman runner bundle + baseline tools to a user Dockerfile.
 * v1 targets glibc/apt bases; the apt install is best-effort (`|| true`) so
 * non-apt bases still build (git is then expected from the base image).
 * If the base is already journeyman/runner-base, injection is skipped.
 */
export function wrapDockerfile(userContent: string, bundleRef: string): string {
  if (/^\s*FROM\s+journeyman\/runner-base/im.test(userContent)) {
    return userContent.trimEnd() + "\n";
  }
  return [
    userContent.trimEnd(),
    "",
    "# ── appended by Journeyman (runner bundle + baseline tools) ──",
    "USER root",
    "RUN (command -v apt-get >/dev/null 2>&1 && apt-get update && " +
      "apt-get install -y --no-install-recommends git openssh-client ca-certificates && " +
      "rm -rf /var/lib/apt/lists/*) || true",
    `COPY --from=${bundleRef} /opt/journeyman /opt/journeyman`,
    "ENV PATH=/opt/journeyman/bin:$PATH",
    "",
  ].join("\n");
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run packages/workers/src/backends/docker/dockerfile-wrap.test.ts`
Expected: PASS (4 tests).

---

## Task 2: The `journeyman/runner-bundle` image

**Files:**
- Create: `docker/runner-bundle.Dockerfile`
- Create: `scripts/build-runner-bundle.sh`

- [ ] **Step 1: Create the Dockerfile**

Create `docker/runner-bundle.Dockerfile`:

```dockerfile
# syntax=docker/dockerfile:1.7
# journeyman/runner-bundle — a relocatable /opt/journeyman (Node + the runner)
# meant to be COPY --from'd into any glibc base image (Dockerfile auto-wrap, spec §8).
FROM node:22-slim AS build
WORKDIR /opt/journeyman/app
COPY package.json package-lock.json ./
COPY packages ./packages
RUN find packages -mindepth 2 -maxdepth 2 ! -name 'package.json' -exec rm -rf {} + 2>/dev/null || true
RUN npm ci --include=dev
COPY . .
RUN mkdir -p /opt/journeyman/bin \
 && cp "$(command -v node)" /opt/journeyman/node \
 && printf '#!/bin/sh\nexec /opt/journeyman/node /opt/journeyman/app/node_modules/.bin/tsx /opt/journeyman/app/packages/coding-cli/src/runner/cli.ts "$@"\n' \
      > /opt/journeyman/bin/journeyman-runner \
 && chmod +x /opt/journeyman/bin/journeyman-runner

# Minimal carrier image: only the relocatable bundle, for COPY --from.
FROM scratch AS bundle
COPY --from=build /opt/journeyman /opt/journeyman
```

- [ ] **Step 2: Create the build helper**

Create `scripts/build-runner-bundle.sh`:

```bash
#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
TAG="${TAG:-dev}"
IMAGE="journeyman/runner-bundle:${TAG}"
echo ">>> Building ${IMAGE}"
docker build -f docker/runner-bundle.Dockerfile --target bundle -t "${IMAGE}" .
echo "OK: built ${IMAGE}"
```

- [ ] **Step 3: Make it executable + build (GATED — Docker required)**

Run: `chmod +x scripts/build-runner-bundle.sh && ./scripts/build-runner-bundle.sh`
Expected: builds `journeyman/runner-bundle:dev`. If no Docker, skip + note.

---

## Task 3: `buildDockerfileImage` (hash + cache + build)

**Files:**
- Create: `packages/workers/src/backends/docker/build-image.ts`
- Test: `packages/workers/src/backends/docker/build-image.test.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/workers/src/backends/docker/build-image.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import type { DockerCommandRunner } from "./docker-command-runner.ts";
import { buildDockerfileImage } from "./build-image.ts";

function recorder(inspectExit: number): { docker: DockerCommandRunner; calls: string[][] } {
  const calls: string[][] = [];
  const docker: DockerCommandRunner = async (args) => {
    calls.push(args);
    if (args[0] === "image" && args[1] === "inspect") return { stdout: "", stderr: "", exitCode: inspectExit };
    return { stdout: "", stderr: "", exitCode: 0 };
  };
  return { docker, calls };
}

describe("buildDockerfileImage", () => {
  it("returns the cached tag without building when the image already exists", async () => {
    const { docker, calls } = recorder(0); // inspect exit 0 ⇒ exists
    const ref = await buildDockerfileImage({ content: "FROM x", docker, bundleRef: "b:dev" });
    expect(ref).toMatch(/^journeyman\/jm-built:[0-9a-f]{16}$/);
    expect(calls.some((c) => c[0] === "build")).toBe(false);
  });

  it("builds and tags when the image is absent", async () => {
    const { docker, calls } = recorder(1); // inspect exit 1 ⇒ missing
    const ref = await buildDockerfileImage({ content: "FROM x", docker, bundleRef: "b:dev" });
    const build = calls.find((c) => c[0] === "build")!;
    expect(build).toContain("-t");
    expect(build).toContain(ref);
  });

  it("is deterministic: same content+bundle ⇒ same tag", async () => {
    const a = await buildDockerfileImage({ content: "FROM x", docker: recorder(0).docker, bundleRef: "b:dev" });
    const b = await buildDockerfileImage({ content: "FROM x", docker: recorder(0).docker, bundleRef: "b:dev" });
    expect(a).toBe(b);
    const c = await buildDockerfileImage({ content: "FROM y", docker: recorder(0).docker, bundleRef: "b:dev" });
    expect(c).not.toBe(a);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run packages/workers/src/backends/docker/build-image.test.ts`
Expected: FAIL — cannot resolve `./build-image.ts`.

- [ ] **Step 3: Write the implementation**

Create `packages/workers/src/backends/docker/build-image.ts`:

```typescript
import { createHash } from "node:crypto";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { DockerCommandRunner } from "./docker-command-runner.ts";
import { wrapDockerfile } from "./dockerfile-wrap.ts";

export interface BuildDockerfileImageDeps {
  content: string;
  docker: DockerCommandRunner;
  bundleRef: string;
  tagPrefix?: string;
}

/** Build (or reuse) an image from a user Dockerfile, auto-wrapped with the runner bundle. */
export async function buildDockerfileImage(deps: BuildDockerfileImageDeps): Promise<string> {
  const effective = wrapDockerfile(deps.content, deps.bundleRef);
  const hash = createHash("sha256").update(effective).digest("hex").slice(0, 16);
  const tag = `${deps.tagPrefix ?? "journeyman/jm-built"}:${hash}`;

  const exists = await deps.docker(["image", "inspect", tag]);
  if (exists.exitCode === 0) return tag;

  const dir = await mkdtemp(join(tmpdir(), "jm-build-"));
  try {
    const dockerfilePath = join(dir, "Dockerfile");
    await writeFile(dockerfilePath, effective, "utf8");
    // Empty build context (v1 Dockerfiles don't COPY local files; COPY --from uses an image).
    const r = await deps.docker(["build", "-t", tag, "-f", dockerfilePath, dir]);
    if (r.exitCode !== 0) throw new Error(`docker build failed: ${r.stderr.trim()}`);
    return tag;
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run packages/workers/src/backends/docker/build-image.test.ts`
Expected: PASS (3 tests).

---

## Task 4: `resolveDockerSpec` (ref or built dockerfile)

**Files:**
- Modify: `packages/workers/src/backends/docker/docker-backend.ts`
- Modify: `packages/workers/src/backends/docker/docker-backend.test.ts`

- [ ] **Step 1: Add the async resolver (keep `dockerSpecFromConfig` for the ref path)**

In `packages/workers/src/backends/docker/docker-backend.ts`, add imports + a new function (do NOT remove `dockerSpecFromConfig`):

```typescript
import { buildDockerfileImage } from "./build-image.ts";
import type { DockerCommandRunner } from "./docker-command-runner.ts";

export interface ResolveDockerSpecDeps {
  docker: DockerCommandRunner;
  defaultImage: string;
  bundleRef: string;
}

/**
 * Build an ExecutionEnvironmentSpec from a docker worker's config, BUILDING the
 * image first when the config supplies a Dockerfile (auto-wrapped + cached).
 */
export async function resolveDockerSpec(
  config: Record<string, unknown>,
  deps: ResolveDockerSpecDeps,
): Promise<import("@journeyman/core").ExecutionEnvironmentSpec> {
  const image = config.image as { kind?: string; imageRef?: string; content?: string } | undefined;
  let imageRef: string;
  if (image?.kind === "dockerfile" && typeof image.content === "string") {
    imageRef = await buildDockerfileImage({ content: image.content, docker: deps.docker, bundleRef: deps.bundleRef });
  } else if (image?.kind === "ref" && image.imageRef) {
    imageRef = image.imageRef;
  } else {
    imageRef = deps.defaultImage;
  }
  const network = config.network === "none" ? "none" : "full";
  const resources = (config.resources as import("@journeyman/core").ExecutionEnvironmentSpec["resources"]) ?? undefined;
  const env = (config.env as Record<string, string>) ?? undefined;
  return { imageRef, network, ...(resources ? { resources } : {}), ...(env ? { env } : {}) };
}
```

(`dockerSpecFromConfig` keeps throwing for dockerfile — it remains the *sync* ref-only helper used by existing tests; the provisioner switches to `resolveDockerSpec`.)

- [ ] **Step 2: Add a test for the dockerfile path**

Add to `packages/workers/src/backends/docker/docker-backend.test.ts`:

```typescript
import { resolveDockerSpec } from "./docker-backend.ts";

describe("resolveDockerSpec", () => {
  it("uses a prebuilt ref directly (no build)", async () => {
    const calls: string[][] = [];
    const docker = async (args: string[]) => { calls.push(args); return { stdout: "", stderr: "", exitCode: 0 }; };
    const spec = await resolveDockerSpec({ image: { kind: "ref", imageRef: "x:1" } }, { docker, defaultImage: "d:1", bundleRef: "b:dev" });
    expect(spec.imageRef).toBe("x:1");
    expect(calls.some((c) => c[0] === "build")).toBe(false);
  });

  it("builds a dockerfile config to a jm-built ref", async () => {
    const docker = async (args: string[]) =>
      ({ stdout: "", stderr: "", exitCode: args[0] === "image" ? 1 : 0 }); // missing ⇒ build
    const spec = await resolveDockerSpec({ image: { kind: "dockerfile", content: "FROM x" } }, { docker, defaultImage: "d:1", bundleRef: "b:dev" });
    expect(spec.imageRef).toMatch(/^journeyman\/jm-built:/);
  });
});
```

- [ ] **Step 3: Run tests**

Run: `npx vitest run packages/workers/src/backends/docker/docker-backend.test.ts`
Expected: PASS (existing 7 + 2 new = 9).

---

## Task 5: Wire the provisioner + exports

**Files:**
- Modify: `packages/workers/src/index.ts`
- Modify: `packages/api-server/src/composition.ts`

- [ ] **Step 1: Export the new surface**

Append to `packages/workers/src/index.ts`:

```typescript
export { wrapDockerfile } from "./backends/docker/dockerfile-wrap.ts";
export { buildDockerfileImage } from "./backends/docker/build-image.ts";
export type { BuildDockerfileImageDeps } from "./backends/docker/build-image.ts";
export { resolveDockerSpec } from "./backends/docker/docker-backend.ts";
export type { ResolveDockerSpecDeps } from "./backends/docker/docker-backend.ts";
```

- [ ] **Step 2: Provisioner builds dockerfile workers**

In `packages/api-server/src/composition.ts`, change the import to add `resolveDockerSpec` and drop the now-unused `dockerSpecFromConfig` (or keep both), and in `sandboxProvisioner` replace:

```typescript
        const spec = dockerSpecFromConfig((worker.config as Record<string, unknown>) ?? {}, RUNNER_IMAGE);
```

with:

```typescript
        const spec = await resolveDockerSpec((worker.config as Record<string, unknown>) ?? {}, {
          docker: dockerCmd, defaultImage: RUNNER_IMAGE,
          bundleRef: process.env.JOURNEYMAN_RUNNER_BUNDLE ?? "journeyman/runner-bundle:dev",
        });
```

- [ ] **Step 3: Typecheck**

Run: `npm run typecheck -w @journeyman/workers && npm run typecheck -w @journeyman/api-server`
Expected: both PASS.

---

## Task 6: Verification

**Files:** none + a gated integration addition.

- [ ] **Step 1: Add a gated build-from-Dockerfile integration case**

Add to `packages/workers/src/backends/docker/docker-integration.test.ts` (inside the gated `describe.skipIf(!RUN_IT)`):

```typescript
  it("builds an image from a Dockerfile and runs the runner in it", async () => {
    const bundle = process.env.JM_RUNNER_BUNDLE ?? "journeyman/runner-bundle:dev";
    const docker = makeProcessCommandRunner("docker");
    const { buildDockerfileImage } = await import("./build-image.ts");
    const builtRef = await buildDockerfileImage({ content: "FROM debian:stable-slim", docker, bundleRef: bundle });
    const env = new DockerExecutionEnvironment({ docker, defaultImage: builtRef });
    const runId = `it-df-${Date.now()}`;
    const p = await env.provision(runId, { imageRef: builtRef });
    try {
      const res = await env.exec(p, { op: "definitely-not-a-real-op", stdin: {} });
      expect(res.ok).toBe(false);
      expect(res.error).toMatch(/unknown op/);
    } finally {
      await env.destroy(p);
    }
  }, 300_000);
```

- [ ] **Step 2: Unit suites + typecheck + boundaries**

Run: `npm test -w @journeyman/workers && npm run check`
Expected: PASS (workers gains dockerfile-wrap 4 + build-image 3 + resolveDockerSpec 2; integration still skipped without the flag).

- [ ] **Step 3: Gated real build (Docker required; runner-bundle built in Task 2)**

Run: `JM_DOCKER_IT=1 npx vitest run packages/workers/src/backends/docker/docker-integration.test.ts`
Expected: PASS — builds `debian:stable-slim` + bundle, provisions, execs unknown-op (`ok:false`, "unknown op"), destroys. Proves the wrapped image runs the runner with no API key. If Docker/bundle absent, skipped/documented.

---

## Self-Review

**Spec coverage (§8 Dockerfile path):**
- Auto-wrap any base (user content + baseline tools + `COPY --from` bundle + PATH) → Task 1; skip-injection when `FROM runner-base` → Task 1.
- Relocatable runner bundle → Task 2.
- Build + cache by content hash → Task 3.
- Wire into provisioning (ref OR built dockerfile) → Tasks 4–5.
- **Deferred & documented:** musl/Alpine bundle flavor + multi-arch + libc detection (v1 is glibc/host-arch); build context with local `COPY` files (v1 uses an empty context); fully-relocatable `git` (v1 installs git via apt in the wrap, best-effort).

**Placeholder scan:** No TBD/TODO; testable units have full code + tests. Docker-dependent steps (Tasks 2, 6 Step 3) are explicitly gated.

**Type consistency:** `wrapDockerfile(userContent, bundleRef)` is used by `buildDockerfileImage` (Task 3) and the gated test. `buildDockerfileImage` returns the `journeyman/jm-built:<hash>` ref consumed by `resolveDockerSpec` (Task 4) → an `ExecutionEnvironmentSpec` (Plan 1) used by the provisioner (Task 5) → `DockerExecutionEnvironment.provision`. `DockerCommandRunner` (Plan 4) is the shared seam throughout.
