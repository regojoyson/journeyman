# Dynamic Coding Provider + Worker-Owned Workspace + Container Skill Delivery — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the coding provider dynamic (selectable, not hardcoded to Claude), give the worker ownership of one per-run workspace, and deliver/execute skills inside containers — provider-agnostically.

**Architecture:** A single `createCodingProvider` factory replaces two hardcoded `new ClaudeProvider()` sites. The provider key flows into the container via the runner request. Skills reach the container through a generic `IExecutionEnvironment.materialize` primitive (`putArchive` for docker, copy for local) with **provider-specific placement**. The execution environment owns one workspace per run, provisioned lazily by the worker (provision-if-missing, status-gated), used by all workspace steps via `ctx.workspaceDir`, and reaped at run end. The explicit `create-workspace`/`cleanup-workspace` steps and the `createWorkspace`/`cleanupRepos` `ICodingCLI` methods are removed.

**Tech Stack:** TypeScript (npm workspaces monorepo), Node, `dockerode`, `pg`, `vitest`. Tests run per-package via `vitest run`. Type/boundary gate: `npm run check` (`npm run typecheck` + `npm run check:boundaries`).

**Source spec:** [docs/superpowers/specs/2026-06-01-dynamic-coding-provider-design.md](../specs/2026-06-01-dynamic-coding-provider-design.md)
**Reviewed dry-run resolutions:** [docs/superpowers/TODO.md](../TODO.md)

**Execution constraints (from requester):** create a feature branch first; **do NOT commit**; run typecheck at the end. (Per-task `git commit` steps in the template are intentionally **omitted** here — leave all work uncommitted.)

---

## File Structure

**New files**
- `packages/coding-cli/src/providers/factory.ts` — `createCodingProvider(key, opts)` provider factory.
- `packages/skills/src/bundle-skills.ts` — `bundleEnabledSkills(skills)` → tar `FileBundle` + path mapping (provider-agnostic packaging).
- `packages/orchestrator/src/workers/skill-placement.ts` — provider-specific skill placement (Claude: package-dir plugin path); keyed by provider.
- `packages/orchestrator/src/sandbox/ensure-workspace.ts` — `ensureWorkspace(...)` provision-if-missing (local + docker), status-gated.
- `packages/migrations/<n>__sandbox_status.sql` — add `status` to `jm_sandbox_instances` (if not already present with the needed states).

**Modified — Job 1/2 (dynamic provider)**
- `packages/coding-cli/src/index.ts`, `runner/cli.ts`, `runner/run-cli.ts`, `runner/runner-types.ts`
- `packages/orchestrator/src/cli-worker.ts`, `sandbox/sandbox-coding-provider.ts`
- `packages/workers/src/backends/docker/docker-execution-environment.ts`
- `packages/core/src/types/execution-environment.types.ts` (`ExecOp.provider`)

**Modified — Job 3 (skills)**
- `packages/core/src/types/execution-environment.types.ts` (`FileBundle`, `IExecutionEnvironment.materialize`), `step-handler.types.ts` (`StepContext.materialize`)
- `packages/workers/src/backends/docker/docker-client.ts` (`putArchive`), `docker-execution-environment.ts` (`materialize`), `backends/local/local-execution-environment.ts` (`materialize`), `backends/contract.ts` (contract test)
- `packages/orchestrator/src/workers/steps/custom-ai-step-handler.ts`

**Modified — Job 4 (workspace) + dry-run fixes**
- `packages/orchestrator/src/workers/worker-harness.ts`, `cli-worker.ts`, `sandbox/sandbox-reaper`(workers), `api-server/src/composition.ts`
- `packages/workers/src/backends/local/local-execution-environment.ts` (retainWorkspace already honored), `sandbox-store.ts`
- step handlers: `clone-repos-step-handler.ts`, `list-workspace-files-step-handler.ts`, `start-feature-branch-step-handler.ts`
- `packages/git-provider/src/providers/github/operations/clone-repos.ts` (idempotent)

**Deleted**
- `packages/orchestrator/src/workspace/directory-workspace-provider.ts`
- `create-workspace` + `cleanup-workspace`: step files (`packages/steps/src/repos/create-workspace.*`, `cleanup-workspace.*`), handlers (`packages/orchestrator/src/workers/steps/create-workspace-step-handler.ts`, `cleanup-workspace-step-handler.ts`)
- `ICodingCLI.createWorkspace` + `ICodingCLI.cleanupRepos` and all their impls/types/dispatch/sandbox methods

**Modified — UI / validation removal (Finding Q)**
- `packages/core/src/validation/validate-for-publish.ts`
- `packages/flow-editor/src/properties-panel/McpToolsTab.tsx`
- `packages/web/src/components/custom-steps/EditCustomStepModal.tsx`, `InputFieldsEditor.tsx`
- step metas: `packages/steps/src/git/clone-repos.meta.ts`, `packages/steps/src/repos/list-workspace-files.meta.ts`

---

## Task 0: Create the feature branch (no commits after this)

- [ ] **Step 1: Branch from the current HEAD**

```bash
git checkout -b feat/dynamic-coding-provider
```

- [ ] **Step 2: Confirm clean baseline typecheck (optional sanity)**

Run: `npm run typecheck`
Expected: passes (or note any pre-existing errors to distinguish from ours).

> Do **not** commit at any point. All tasks leave changes in the working tree.

---

## Phase 1 — Job 1: Dynamic provider factory

### Task 1: `createCodingProvider` factory

**Files:**
- Create: `packages/coding-cli/src/providers/factory.ts`
- Modify: `packages/coding-cli/src/index.ts`
- Test: `packages/coding-cli/src/providers/factory.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// packages/coding-cli/src/providers/factory.test.ts
import { describe, it, expect } from "vitest";
import { createCodingProvider } from "./factory.ts";
import { ClaudeProvider } from "./claude/index.ts";

describe("createCodingProvider", () => {
  it("returns a ClaudeProvider for 'claude'", () => {
    const p = createCodingProvider("claude", { env: { ANTHROPIC_API_KEY: "k" } });
    expect(p).toBeInstanceOf(ClaudeProvider);
  });
  it("defaults to claude when key is undefined", () => {
    const p = createCodingProvider(undefined, { env: {} });
    expect(p).toBeInstanceOf(ClaudeProvider);
  });
  it("throws a ConfigurationError for an unknown provider", () => {
    expect(() => createCodingProvider("nope", { env: {} }))
      .toThrowError(/Unknown coding provider: nope/);
  });
});
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `cd packages/coding-cli && npx vitest run src/providers/factory.test.ts`
Expected: FAIL — module `./factory.ts` not found.

- [ ] **Step 3: Implement the factory**

```ts
// packages/coding-cli/src/providers/factory.ts
import type { ICodingCLI } from "@journeyman/core";
import { ClaudeProvider } from "./claude/index.ts";

export interface CreateCodingProviderOpts {
  env: Record<string, string>;
  /** Per-call model override (string; e.g. "claude-sonnet-4-6"). */
  model?: string;
}

/**
 * Single source of truth for constructing a coding provider from a provider key.
 * Used by the in-process worker factory AND the container runner CLI, so adding
 * a provider is one `case` here.
 */
export function createCodingProvider(
  key: string | undefined,
  opts: CreateCodingProviderOpts,
): ICodingCLI {
  switch (key ?? "claude") {
    case "claude":
      return new ClaudeProvider({ apiKey: opts.env.ANTHROPIC_API_KEY });
    // future providers (opencode, …) add one case here
    default: {
      const err = new Error(`Unknown coding provider: ${key}`) as Error & { name: string };
      err.name = "ConfigurationError";
      throw err;
    }
  }
}
```

- [ ] **Step 4: Export it**

In `packages/coding-cli/src/index.ts` add:

```ts
export { createCodingProvider } from "./providers/factory.ts";
export type { CreateCodingProviderOpts } from "./providers/factory.ts";
```

- [ ] **Step 5: Run the test to confirm it passes**

Run: `cd packages/coding-cli && npx vitest run src/providers/factory.test.ts`
Expected: PASS.

### Task 2: Use the factory in the in-process worker

**Files:**
- Modify: `packages/orchestrator/src/cli-worker.ts:68-78`

- [ ] **Step 1: Replace the inline switch**

Replace the `const coding: ProviderFactory<ICodingCLI> = (key, env) => { switch … }` block with:

```ts
import { ClaudeProvider, createCodingProvider } from "@journeyman/coding-cli";
// ...
const coding: ProviderFactory<ICodingCLI> = (key, env) => createCodingProvider(key, { env });
```

(Keep the `ClaudeProvider` import only if still referenced elsewhere; otherwise drop it.)

- [ ] **Step 2: Typecheck the package**

Run: `npm run typecheck`
Expected: passes (no new errors in orchestrator).

---

## Phase 2 — Job 2: Provider key into the container

### Task 3: Add `provider` to `ExecOp` and `RunnerRequest`

**Files:**
- Modify: `packages/core/src/types/execution-environment.types.ts` (`ExecOp`)
- Modify: `packages/coding-cli/src/runner/runner-types.ts` (`RunnerRequest`)

- [ ] **Step 1: Add `provider` to `ExecOp`**

In `ExecOp` add:

```ts
  /** Coding provider key for this op (e.g. "claude"). Selects the SDK in the runner. */
  provider?: string;
```

- [ ] **Step 2: Add `provider` to `RunnerRequest`**

In `packages/coding-cli/src/runner/runner-types.ts`, add to `RunnerRequest`:

```ts
  /** Coding provider key; runner builds the matching provider. Defaults to "claude". */
  provider?: string;
```

### Task 4: Carry the provider key through `SandboxCodingProvider`

**Files:**
- Modify: `packages/orchestrator/src/sandbox/sandbox-coding-provider.ts`
- Test: `packages/orchestrator/src/sandbox/sandbox-coding-provider.test.ts`

- [ ] **Step 1: Extend the failing test**

Add to the existing test file:

```ts
import { describe, it, expect, vi } from "vitest";
import { SandboxCodingProvider } from "./sandbox-coding-provider.ts";

describe("SandboxCodingProvider provider key", () => {
  it("includes the provider key on every ExecOp", async () => {
    const exec = vi.fn().mockResolvedValue({ ok: true, structured: { result: "ok" } });
    const p = new SandboxCodingProvider(exec, "claude");
    await p.runCustomPrompt({ prompt: "hi", outputMode: "text" } as any);
    expect(exec).toHaveBeenCalledWith(expect.objectContaining({ op: "custom-prompt", provider: "claude" }));
  });
});
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `cd packages/orchestrator && npx vitest run src/sandbox/sandbox-coding-provider.test.ts`
Expected: FAIL — constructor takes one arg / `provider` not on op.

- [ ] **Step 3: Add the provider key to the constructor + every op**

```ts
export class SandboxCodingProvider implements ICodingCLI {
  constructor(private exec: ExecFn, private provider?: string) {}
  // in each method's this.exec({...}) call, add: provider: this.provider,
}
```

Add `provider: this.provider,` to each `this.exec({ op: ..., ... })` object (`runCustomPrompt`, `scanRepos`, `checkoutRepo`). (`createWorkspace`/`cleanupRepos` will be deleted in Phase 7.)

- [ ] **Step 4: Run the test to confirm it passes**

Run: `cd packages/orchestrator && npx vitest run src/sandbox/sandbox-coding-provider.test.ts`
Expected: PASS.

### Task 5: Forward `provider` in `DockerExecutionEnvironment.exec` and use the factory in the runner

**Files:**
- Modify: `packages/workers/src/backends/docker/docker-execution-environment.ts` (`exec`)
- Modify: `packages/coding-cli/src/runner/cli.ts`, `packages/coding-cli/src/runner/run-cli.ts`

- [ ] **Step 1: Include `provider` in the request JSON**

In `DockerExecutionEnvironment.exec`, change the request build to:

```ts
const request = JSON.stringify({
  op: op.op,
  provider: op.provider,
  opts: { ...((op.stdin as object) ?? {}), cwd: WORKSPACE },
});
```

- [ ] **Step 2: Thread `provider` through `run-cli.ts`**

`runRunnerCli` already takes the provider instance, but the runner CLI must build it from `req.provider`. Change the signature so the CLI builds the provider:

```ts
// run-cli.ts — replace the `provider` param with a provider factory
export async function runRunnerCli(
  input: string,
  makeProvider: (key: string | undefined) => ICodingCLI,
  onLog?: CodingCliLogFn,
): Promise<string> {
  let req: RunnerRequest;
  try { req = JSON.parse(input) as RunnerRequest; }
  catch (e) { return JSON.stringify({ ok: false, error: `invalid JSON request: ${(e as Error).message}` }); }
  if (!req || typeof req.op !== "string") return JSON.stringify({ ok: false, error: "request must include a string 'op'" });
  const provider = makeProvider(req.provider);
  const res = await dispatchOperation(provider, req.op, req.opts ?? {}, { ...(onLog ? { onLog } : {}) });
  return JSON.stringify(res);
}
```

- [ ] **Step 3: Build the provider via the factory in `cli.ts`**

```ts
// cli.ts main()
import { createCodingProvider } from "../index.ts";
// ...
const out = await runRunnerCli(
  input,
  (key) => createCodingProvider(key, { env: process.env as Record<string, string> }),
  (line, meta) => process.stderr.write(JSON.stringify({ line, meta }) + "\n"),
);
```

- [ ] **Step 4: Update the run-cli test for the new signature**

In `packages/coding-cli/src/runner/run-cli.test.ts`, pass a `makeProvider` thunk (e.g. `() => fakeProvider`) wherever it passed a provider, and add a case asserting `req.provider` selects via the factory (use a stub factory).

- [ ] **Step 5: Run the runner tests**

Run: `cd packages/coding-cli && npx vitest run src/runner`
Expected: PASS.

---

## Phase 3 — Job 3 infra: generic `materialize` + `putArchive` + bundle

### Task 6: `FileBundle` type + `IExecutionEnvironment.materialize` + `StepContext.materialize`

**Files:**
- Modify: `packages/core/src/types/execution-environment.types.ts`
- Modify: `packages/core/src/types/step-handler.types.ts`

- [ ] **Step 1: Add the `FileBundle` type and `materialize` to the interface**

In `execution-environment.types.ts`:

```ts
import type { Readable } from "node:stream";

/** A streamable set of files to deliver into an environment (a tar stream/buffer). */
export interface FileBundle {
  /** tar stream or buffer whose entries are relative paths under the destination dir. */
  tar: Readable | Buffer;
}
```

Add to `IExecutionEnvironment`:

```ts
  /**
   * Replace the contents of `destDir` (inside the environment) with `bundle`.
   * Implementations clear destDir first, then extract — so callers get exactly
   * the bundled files (per-step skill staging relies on this).
   */
  materialize(env: ProvisionedEnv, destDir: string, bundle: FileBundle): Promise<void>;
```

- [ ] **Step 2: Add `materialize` to `StepContext`**

In `step-handler.types.ts`, add to `StepContext`:

```ts
  /** Present on sandboxed/workspace runs — deliver files into the workspace (replace destDir). */
  materialize?: (destDir: string, bundle: import("./execution-environment.types.ts").FileBundle) => Promise<void>;
```

- [ ] **Step 3: Typecheck core**

Run: `cd packages/core && npx tsc --noEmit`
Expected: FAILS in `workers` (backends don't implement `materialize` yet) — that's expected; fixed in Tasks 7–9. Core itself compiles.

### Task 7: `putArchive` on the Docker client

**Files:**
- Modify: `packages/workers/src/backends/docker/docker-client.ts` (interface `IDockerClient` + `DockerodeClient`)
- Test: `packages/workers/src/backends/docker/docker-client.test.ts` (new or extend)

- [ ] **Step 1: Add to the `IDockerClient` interface**

```ts
  putArchive(containerId: string, tar: import("node:stream").Readable | Buffer, opts: { path: string }): Promise<void>;
```

- [ ] **Step 2: Implement on `DockerodeClient`**

```ts
async putArchive(
  containerId: string,
  tar: import("node:stream").Readable | Buffer,
  opts: { path: string },
): Promise<void> {
  const c = this.docker.getContainer(containerId);
  await c.putArchive(tar, { path: opts.path });
}
```

- [ ] **Step 3: (Light) test via a fake docker client in the env test (Task 9).** No standalone test needed if covered by the env test; if adding one, mock `getContainer().putArchive`.

### Task 8: `LocalExecutionEnvironment.materialize`

**Files:**
- Modify: `packages/workers/src/backends/local/local-execution-environment.ts`
- Test: covered by the contract test (Task 10)

- [ ] **Step 1: Implement `materialize` (wipe + extract/copy)**

```ts
import { mkdir, rm } from "node:fs/promises";
import { extract } from "tar"; // already a transitive dep; if not, add `tar` to packages/workers
import type { FileBundle } from "@journeyman/core";
import { Readable } from "node:stream";

async materialize(env: ProvisionedEnv, destDir: string, bundle: FileBundle): Promise<void> {
  const abs = join(env.workspaceDir, destDir.replace(/^\/workspace\/?/, "").replace(/^\//, ""));
  await rm(abs, { recursive: true, force: true });
  await mkdir(abs, { recursive: true });
  await new Promise<void>((resolve, reject) => {
    const src = bundle.tar instanceof Buffer ? Readable.from(bundle.tar) : bundle.tar;
    src.pipe(extract({ cwd: abs })).on("finish", resolve).on("error", reject);
  });
}
```

> Note: `destDir` for local is interpreted relative to the env's `workspaceDir`. If the project doesn't already depend on `tar`, add `"tar": "^7"` to `packages/workers/package.json` and `packages/skills/package.json`.

### Task 9: `DockerExecutionEnvironment.materialize`

**Files:**
- Modify: `packages/workers/src/backends/docker/docker-execution-environment.ts`
- Test: `packages/workers/src/backends/docker/docker-execution-environment.test.ts`

- [ ] **Step 1: Write the failing test (fake client)**

```ts
import { describe, it, expect, vi } from "vitest";
import { DockerExecutionEnvironment } from "./docker-execution-environment.ts";

it("materialize wipes destDir then putArchives", async () => {
  const exec = vi.fn().mockResolvedValue({ stdout: "", exitCode: 0 });
  const putArchive = vi.fn().mockResolvedValue(undefined);
  const client = { exec, putArchive } as any;
  const env = new DockerExecutionEnvironment({ client });
  await env.materialize(
    { runId: "r", type: "docker", handle: "c1", workspaceDir: "/workspace" } as any,
    "/workspace/.journeyman/skills",
    { tar: Buffer.from("x") },
  );
  expect(exec).toHaveBeenCalledWith("c1", expect.objectContaining({
    cmd: expect.arrayContaining(["sh", "-c"]),
  }));
  expect(putArchive).toHaveBeenCalledWith("c1", expect.anything(), { path: "/workspace/.journeyman/skills" });
});
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `cd packages/workers && npx vitest run src/backends/docker/docker-execution-environment.test.ts`
Expected: FAIL — `materialize` not defined.

- [ ] **Step 3: Implement `materialize`**

```ts
async materialize(env: ProvisionedEnv, destDir: string, bundle: FileBundle): Promise<void> {
  // 1. wipe + recreate the dir inside the container
  await this.deps.client.exec(env.handle, {
    cmd: ["sh", "-c", `rm -rf "${destDir}"/* 2>/dev/null; mkdir -p "${destDir}"`],
  });
  // 2. stream the tar into the container at destDir
  await this.deps.client.putArchive(env.handle, bundle.tar, { path: destDir });
}
```

(Add `FileBundle` to the type imports.)

- [ ] **Step 4: Run the test to confirm it passes**

Run: `cd packages/workers && npx vitest run src/backends/docker/docker-execution-environment.test.ts`
Expected: PASS.

### Task 10: Contract test for `materialize`

**Files:**
- Modify: `packages/workers/src/backends/contract.ts`

- [ ] **Step 1: Add a `materialize` case to the shared contract**

```ts
it("materialize replaces destDir contents", async () => {
  const env = await makeEnv();
  const p = await env.provision("run-mat", {});
  // implementations differ; just assert it resolves and the env stays usable
  await expect(env.materialize(p, `${p.workspaceDir}/.staging`, { tar: Buffer.from("") })).resolves.toBeUndefined();
  await env.destroy(p);
});
```

- [ ] **Step 2: Run the local backend contract test**

Run: `cd packages/workers && npx vitest run`
Expected: PASS for the local backend (docker contract may be gated behind a daemon — keep its skip behavior).

### Task 11: `bundleEnabledSkills`

**Files:**
- Create: `packages/skills/src/bundle-skills.ts`
- Modify: `packages/skills/src/index.ts`
- Test: `packages/skills/src/bundle-skills.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { bundleEnabledSkills } from "./bundle-skills.ts";

describe("bundleEnabledSkills", () => {
  it("packs each package dir and returns an in-container mapping", () => {
    const root = mkdtempSync(join(tmpdir(), "pkg-"));
    mkdirSync(join(root, "skills", "alpha"), { recursive: true });
    writeFileSync(join(root, "skills", "alpha", "SKILL.md"), "# alpha");
    const { tar, mapping } = bundleEnabledSkills(
      [{ id: "p1", name: "pkg", localPath: root, enabledSkills: ["alpha"], gitUrl: "", cliType: "claude" } as any],
      "/workspace/.journeyman/skills",
    );
    expect(tar).toBeDefined();
    expect(mapping).toEqual([{ id: "p1", containerPath: "/workspace/.journeyman/skills/pkg" }]);
  });
});
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `cd packages/skills && npx vitest run src/bundle-skills.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `bundleEnabledSkills`**

```ts
// packages/skills/src/bundle-skills.ts
import { create as tarCreate } from "tar";
import { basename } from "node:path";
import type { Readable } from "node:stream";
import type { FileBundle, ResolvedSkillPackage } from "@journeyman/core";

export interface SkillBundleResult {
  bundle: FileBundle;
  /** in-container path for each package root (for localPath rewrite). */
  mapping: Array<{ id: string; containerPath: string }>;
}

/**
 * Pack each resolved skill *package* directory into one tar, placed under
 * `<destDir>/<packageDirName>/...`. Returns the per-package in-container path so
 * the caller can rewrite ResolvedSkillPackage.localPath to the materialized root.
 */
export function bundleEnabledSkills(
  skills: ResolvedSkillPackage[],
  destDir: string,
): SkillBundleResult {
  const dirs: string[] = [];
  const mapping: Array<{ id: string; containerPath: string }> = [];
  for (const s of skills) {
    if (!s.localPath) continue;
    const dirName = basename(s.localPath);
    dirs.push(s.localPath);
    mapping.push({ id: s.id, containerPath: `${destDir}/${dirName}` });
  }
  // tar entries keyed by the package dir basename so they extract as <destDir>/<dirName>/...
  const tar = tarCreate(
    { cwd: dirs.length ? dirsCommonParent(dirs) : process.cwd(), portable: true },
    dirs.map((d) => basename(d)),
  ) as unknown as Readable;
  return { bundle: { tar }, mapping };
}

function dirsCommonParent(dirs: string[]): string {
  // All cached skill packages live under the same SKILLS_CACHE_DIR; use that parent.
  const first = dirs[0];
  return first.slice(0, first.lastIndexOf("/"));
}
```

> Implementation note: all packages share `SKILLS_CACHE_DIR` as parent, so taring by `basename` with `cwd = parent` is safe. If a future package lives elsewhere, switch to per-package tars merged into one stream.

- [ ] **Step 4: Export + run the test**

Add to `packages/skills/src/index.ts`:
```ts
export { bundleEnabledSkills } from "./bundle-skills.ts";
export type { SkillBundleResult } from "./bundle-skills.ts";
```

Run: `cd packages/skills && npx vitest run src/bundle-skills.test.ts`
Expected: PASS.

---

## Phase 4 — Job 4: Worker-owned workspace

### Task 12: Sandbox `status` column (provisioning → active)

**Files:**
- Create: `packages/migrations/<next-number>__sandbox_status.sql`
- Modify: `packages/workers/src/sandbox-store.ts`

> First read `docs/constitution/DATABASE_ARCHITECTURE.md` and check whether `jm_sandbox_instances.status` already includes a `provisioning` state. If it has only `active`/`destroyed`, add `provisioning`.

- [ ] **Step 1: Migration (append-only)**

```sql
-- packages/migrations/<n>__sandbox_status.sql
-- Allow a transient 'provisioning' state before a sandbox becomes 'active'.
ALTER TABLE jm_sandbox_instances
  ALTER COLUMN status SET DEFAULT 'provisioning';
-- (No CHECK change needed if status is free text; otherwise extend the allowed set.)
```

- [ ] **Step 2: Add store helpers**

In `sandbox-store.ts` add:

```ts
/** Insert a provisioning row only if absent. Returns true if THIS caller won (must provision). */
export async function claimSandbox(
  db: Queryable,
  row: { runId: string; type: string; owner: string },
): Promise<boolean> {
  const r = await db.query(
    `INSERT INTO jm_sandbox_instances (run_id, type, handle, status, owner)
     VALUES ($1, $2, '', 'provisioning', $3)
     ON CONFLICT (run_id) DO NOTHING
     RETURNING run_id`,
    [row.runId, row.type, row.owner],
  );
  return (r.rowCount ?? 0) > 0;
}

/** Mark a claimed sandbox active with its real handle/volume/connection. */
export async function markSandboxActive(
  db: Queryable,
  runId: string,
  patch: { handle: string; volume?: string | null; imageRef?: string | null; connection?: unknown },
): Promise<void> {
  await db.query(
    `UPDATE jm_sandbox_instances
       SET status = 'active', handle = $2, volume = $3, image_ref = $4, connection = $5
     WHERE run_id = $1`,
    [runId, patch.handle, patch.volume ?? null, patch.imageRef ?? null, patch.connection ?? null],
  );
}
```

> Confirm `jm_sandbox_instances` has a UNIQUE constraint on `run_id`; the existing `getSandbox(... WHERE run_id = $1)` implies one row per run — add a `UNIQUE(run_id)` in the migration if missing (required for `ON CONFLICT (run_id)`).

### Task 13: `ensureWorkspace` (provision-if-missing, status-gated, local + docker)

**Files:**
- Create: `packages/orchestrator/src/sandbox/ensure-workspace.ts`
- Test: `packages/orchestrator/src/sandbox/ensure-workspace.test.ts`

- [ ] **Step 1: Write the failing test (fake pool + builders)**

```ts
import { describe, it, expect, vi } from "vitest";
import { ensureWorkspace } from "./ensure-workspace.ts";

describe("ensureWorkspace", () => {
  it("connects when an active sandbox already exists", async () => {
    const deps = {
      getSandbox: vi.fn().mockResolvedValue({ runId: "r", type: "docker", status: "active", handle: "c1", connection: { kind: "local" }, volume: "v" }),
      claim: vi.fn(),
      provisionDocker: vi.fn(),
      provisionLocal: vi.fn(),
      markActive: vi.fn(),
      waitActive: vi.fn(),
      resolveWorker: vi.fn(),
    };
    const r = await ensureWorkspace(deps as any, { runId: "r", workerId: undefined, userId: "u", orgId: "o" });
    expect(r.provisioned.handle).toBe("c1");
    expect(deps.claim).not.toHaveBeenCalled();
  });

  it("waits when another worker is provisioning", async () => {
    const deps = {
      getSandbox: vi.fn().mockResolvedValue({ runId: "r", type: "docker", status: "provisioning" }),
      claim: vi.fn().mockResolvedValue(false),
      waitActive: vi.fn().mockResolvedValue({ runId: "r", type: "docker", status: "active", handle: "c2" }),
      resolveWorker: vi.fn().mockResolvedValue({ type: "docker", config: {} }),
      provisionDocker: vi.fn(), provisionLocal: vi.fn(), markActive: vi.fn(),
    };
    const r = await ensureWorkspace(deps as any, { runId: "r", workerId: undefined, userId: "u", orgId: "o" });
    expect(deps.waitActive).toHaveBeenCalled();
    expect(r.provisioned.handle).toBe("c2");
  });

  it("fails loud when user/org missing", async () => {
    const deps = { getSandbox: vi.fn().mockResolvedValue(null) } as any;
    await expect(ensureWorkspace(deps, { runId: "r", workerId: undefined, userId: null, orgId: null }))
      .rejects.toThrow(/user\/org/i);
  });
});
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `cd packages/orchestrator && npx vitest run src/sandbox/ensure-workspace.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `ensureWorkspace`**

```ts
// packages/orchestrator/src/sandbox/ensure-workspace.ts
import type { ProvisionedEnv } from "@journeyman/core";

export interface EnsureWorkspaceDeps {
  getSandbox(runId: string): Promise<{ runId: string; type: string; status: string; handle: string; volume?: string | null; connection?: unknown } | null>;
  claim(row: { runId: string; type: string; owner: string }): Promise<boolean>;
  markActive(runId: string, patch: { handle: string; volume?: string | null; imageRef?: string | null; connection?: unknown }): Promise<void>;
  waitActive(runId: string, timeoutMs: number): Promise<{ handle: string; volume?: string | null; connection?: unknown }>;
  resolveWorker(workerId: string | undefined, ctx: { userId: string; orgId: string }): Promise<{ type: string; config: Record<string, unknown> }>;
  provisionDocker(runId: string, worker: { type: string; config: Record<string, unknown> }): Promise<{ env: import("@journeyman/core").IExecutionEnvironment; provisioned: ProvisionedEnv; imageRef?: string; connection?: unknown }>;
  provisionLocal(runId: string): Promise<{ env: import("@journeyman/core").IExecutionEnvironment; provisioned: ProvisionedEnv }>;
}

export interface EnsureWorkspaceResult {
  env: import("@journeyman/core").IExecutionEnvironment;
  provisioned: ProvisionedEnv;
}

const PROVISION_WAIT_MS = Number(process.env.PROVISION_WAIT_MS ?? 300_000);

export async function ensureWorkspace(
  deps: EnsureWorkspaceDeps,
  args: { runId: string; workerId: string | undefined; userId: string | null; orgId: string | null },
): Promise<EnsureWorkspaceResult> {
  const existing = await deps.getSandbox(args.runId);
  if (existing && existing.status === "active") {
    return connect(deps, existing);
  }
  if (!args.userId || !args.orgId) {
    const err = new Error("cannot resolve worker: run is missing user/org context") as Error & { name: string };
    err.name = "ConfigurationError";
    throw err;
  }
  const worker = await deps.resolveWorker(args.workerId, { userId: args.userId, orgId: args.orgId });
  const won = await deps.claim({ runId: args.runId, type: worker.type, owner: args.orgId });
  if (!won) {
    const active = await deps.waitActive(args.runId, PROVISION_WAIT_MS);
    return connect(deps, { runId: args.runId, type: worker.type, status: "active", ...active });
  }
  // we are the builder
  if (worker.type === "local") {
    const { env, provisioned } = await deps.provisionLocal(args.runId);
    await deps.markActive(args.runId, { handle: provisioned.handle });
    return { env, provisioned };
  }
  const { env, provisioned, imageRef, connection } = await deps.provisionDocker(args.runId, worker);
  await deps.markActive(args.runId, { handle: provisioned.handle, volume: provisioned.volume ?? null, imageRef: imageRef ?? null, connection });
  return { env, provisioned };
}

async function connect(deps: EnsureWorkspaceDeps, sb: { runId: string; type: string; handle: string; volume?: string | null; connection?: unknown }): Promise<EnsureWorkspaceResult> {
  if (sb.type === "local") {
    const { env, provisioned } = await deps.provisionLocal(sb.runId); // idempotent mkdir
    return { env, provisioned };
  }
  // docker: rebuild env from the recorded connection + handle
  const { env, provisioned } = await deps.provisionDocker(sb.runId, { type: "docker", config: { connection: sb.connection, __existingHandle: sb.handle, __existingVolume: sb.volume } });
  return { env, provisioned };
}
```

> The `provisionDocker`/`provisionLocal` thunks are wired in `cli-worker.ts` (Task 15) using `@journeyman/workers` (`makeDockerClient`, `DockerExecutionEnvironment`, `resolveDockerSpec`, `LocalExecutionEnvironment`). `connect()` for docker must build a `ProvisionedEnv` from the recorded handle/volume **without** creating a new container (skip `runIdle` when `__existingHandle` is set).

- [ ] **Step 4: Run the test to confirm it passes**

Run: `cd packages/orchestrator && npx vitest run src/sandbox/ensure-workspace.test.ts`
Expected: PASS.

### Task 14: Reaper — local destroy path + `retainWorkspace` + age-TTL

**Files:**
- Modify: `packages/workers/src/sandbox-reaper.ts` (and/or the api-server reaper wiring)
- Modify: `packages/api-server/src/composition.ts` (reaper `destroy` dispatch)

- [ ] **Step 1: Make `destroy` dispatch by type**

In `composition.ts`, replace the docker-only `dockerDestroy` passed to the reaper with a dispatcher:

```ts
const destroyByType = async (sb: SandboxRecord) => {
  if (sb.type === "docker") return dockerDestroy(sb);
  if (sb.type === "local") {
    if ((sb as any).retainWorkspace) return; // honor retainWorkspace (Finding S)
    await rm(join(localBaseDir, sb.runId), { recursive: true, force: true });
  }
};
```

Pass `destroyByType` to both the per-run reaper and `SandboxReaper`. (Local cleanup only works on the host that owns the dir — the worker-host sweep in Task 15 handles per-host; the api-server reaper handles docker centrally.)

- [ ] **Step 2: Worker-host age-TTL sweep (backstop)** — implemented in `cli-worker.ts` Task 15.

### Task 15: Worker harness uses `ensureWorkspace`; demand-driven; `ctx.workspaceDir` + `ctx.materialize`; retire `DirectoryWorkspaceProvider`; local direct in-process

**Files:**
- Modify: `packages/orchestrator/src/workers/worker-harness.ts`
- Modify: `packages/orchestrator/src/cli-worker.ts`
- Delete: `packages/orchestrator/src/workspace/directory-workspace-provider.ts` (Task 18)

- [ ] **Step 1: Replace per-node `workspace.create` with demand-driven `ensureWorkspace`**

In `worker-harness.ts`:
- Remove the unconditional `const ws = await this.deps.workspace.create(...)` and the `ws.destroy()` in `finally`.
- After resolving `stepType`/`handler`, decide whether a workspace is needed:

```ts
const needsWorkspace = handler.requiresWorkspace === true
  || (typeof (handler as any).needsWorkspaceFor === "function" && (handler as any).needsWorkspaceFor(stepInput));
let workspaceDir = "";
let exec: ((op: ExecOp) => Promise<ExecResult>) | undefined;
let materialize: StepContext["materialize"];
if (needsWorkspace) {
  const { env, provisioned } = await this.deps.ensureWorkspace({
    runId: workflowInstanceId, workerId: (stepInput as any).workerId, userId, orgId,
  });
  workspaceDir = provisioned.workspaceDir;
  if (provisioned.type !== "local") {
    exec = (op) => env.exec(provisioned, op);
  }
  materialize = (destDir, bundle) => env.materialize(provisioned, destDir, bundle);
}
```

Pass `workspaceDir`, `...(exec ? { exec } : {})`, `...(materialize ? { materialize } : {})` into `handler.run(stepInput, ctx)`.

> Local runs leave `ctx.exec` undefined → handlers build the provider directly in-process (Finding H). Docker sets `ctx.exec` → handlers use `SandboxCodingProvider`.

- [ ] **Step 2: `custom-ai` demand-driven hook**

`CustomAiStepHandler` currently has static `requiresWorkspace = true`. Change to `requiresWorkspace = false` and add:

```ts
needsWorkspaceFor(input: StepInput): boolean {
  const tools = Array.isArray(input.tools) ? (input.tools as CanonicalTool[]) : undefined;
  // step.defaultTools is unknown at harness time; conservatively require a workspace
  // only if node-level tools require it. (defaultTools-only steps: see note.)
  return tools ? toolsRequireWorkspace(tools) : false;
}
```

> If `defaultTools` (DB) can require a workspace without node-level `tools`, the harness must peek the custom step. Simplest correct approach: keep `requiresWorkspace = true` for custom-ai **but** skip provisioning inside the handler when `!needsWorkspace` — i.e. the handler calls `ctx`-provided lazy `ensureWorkspace` only when it computes `needsWorkspace`. Choose this variant if `defaultTools` resolution must stay in the handler. Document the chosen variant in the PR.

- [ ] **Step 3: Wire `ensureWorkspace` deps in `cli-worker.ts`**

```ts
import {
  makeDockerClient, DockerExecutionEnvironment, LocalExecutionEnvironment,
  resolveWorker, resolveDockerSpec, recordSandbox, getSandbox, claimSandbox, markSandboxActive,
} from "@journeyman/workers";
import { createCodingOperationRunner, createCodingProvider } from "@journeyman/coding-cli";
import { ensureWorkspace } from "./sandbox/ensure-workspace.ts";

const RUNNER_IMAGE = process.env.JOURNEYMAN_RUNNER_IMAGE ?? "journeyman/runner-base:dev";
const RUNNER_BUNDLE = process.env.JOURNEYMAN_RUNNER_BUNDLE ?? "journeyman/runner-bundle:dev";

const ensureWs = (a: { runId: string; workerId?: string; userId: string | null; orgId: string | null }) =>
  ensureWorkspace(
    {
      getSandbox: (id) => getSandbox(pool!, id) as any,
      claim: (row) => claimSandbox(pool!, row),
      markActive: (id, patch) => markSandboxActive(pool!, id, patch),
      waitActive: (id, ms) => waitActive(pool!, id, ms), // small poll helper, see Step 4
      resolveWorker: (workerId, ctx) => resolveWorker(pool!, ctx, workerId),
      provisionLocal: async (runId) => {
        const env = new LocalExecutionEnvironment({
          runOperation: createCodingOperationRunner({ makeProvider: (env2) => createCodingProvider(undefined, { env: env2 }) }),
          baseDir: workspaceBaseDir,
        });
        const provisioned = await env.provision(runId, {});
        return { env, provisioned };
      },
      provisionDocker: async (runId, worker) => {
        const connection = (worker.config.connection as any) ?? { kind: "local" };
        const client = makeDockerClient(connection);
        const env = new DockerExecutionEnvironment({ client, defaultImage: RUNNER_IMAGE });
        if (worker.config.__existingHandle) {
          return { env, provisioned: { runId, type: "docker", handle: String(worker.config.__existingHandle), volume: worker.config.__existingVolume as string | undefined, workspaceDir: "/workspace" }, connection };
        }
        const spec = await resolveDockerSpec(worker.config, { client, defaultImage: RUNNER_IMAGE, bundleRef: RUNNER_BUNDLE });
        const provisioned = await env.provision(runId, spec);
        return { env, provisioned, imageRef: spec.imageRef, connection };
      },
    },
    a,
  );
```

Pass `ensureWorkspace: ensureWs` to `WorkerHarness` deps (replace the `workspace`/`sandboxResolver` deps).

- [ ] **Step 4: `waitActive` poll helper**

```ts
async function waitActive(pool: Pool, runId: string, timeoutMs: number) {
  const start = Date.now();
  // Date.now allowed here (worker runtime, not a workflow script).
  for (;;) {
    const sb = await getSandbox(pool, runId);
    if (sb?.status === "active") return { handle: sb.handle, volume: sb.volume, connection: sb.connection };
    if (Date.now() - start > timeoutMs) throw new Error(`workspace provisioning timed out for run ${runId}`);
    await new Promise((r) => setTimeout(r, 1000));
  }
}
```

- [ ] **Step 5: Worker-host age-TTL sweep for local orphans (backstop)**

Add a small interval in `cli-worker.ts` that scans `workspaceBaseDir` and removes run dirs whose run is no longer active OR older than a TTL (e.g. 24h), respecting `retainWorkspace`.

- [ ] **Step 6: Typecheck**

Run: `npm run typecheck`
Expected: resolve all type errors introduced; passes.

### Task 16: api-server provisioning → optional pre-warm

**Files:**
- Modify: `packages/api-server/src/composition.ts:168-189`

- [ ] **Step 1: Make pre-warm call the same claim/provision path (or remove)**

Simplest safe choice: **remove eager provisioning** (let the worker provision on first step). Delete/disable the `sandboxProvisioner` body for docker (keep the function returning early), and rely on `ProvisioningReaper` watching the sandbox-record `status` (Task 17). If a pre-warm optimization is desired, have it `claimSandbox` + provision via the same helpers, marking `active` — never double-provisioning thanks to `claimSandbox`.

### Task 17: `ProvisioningReaper` watches the record status

**Files:**
- Modify: `packages/orchestrator/src/stores/postgres/provisioning-queries.ts` (`findStuckProvisioningRuns`) and/or `composition.ts`

- [ ] **Step 1: Point stuck-detection at `jm_sandbox_instances.status = 'provisioning'`**

Update `findStuckProvisioningRuns` to select runs whose sandbox row has been `status = 'provisioning'` longer than the timeout, and fail those runs + clean up. (Replaces reliance on a pre-step run-level status.)

- [ ] **Step 2: Typecheck**

Run: `npm run typecheck`
Expected: passes.

---

## Phase 5 — Job 3 wiring: provider-specific skill placement + custom-ai

### Task 18: Provider-specific skill placement

**Files:**
- Create: `packages/orchestrator/src/workers/skill-placement.ts`
- Test: `packages/orchestrator/src/workers/skill-placement.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect, vi } from "vitest";
import { placeSkills } from "./skill-placement.ts";

describe("placeSkills (claude)", () => {
  it("materializes package dirs and rewrites localPath to the container path", async () => {
    const materialize = vi.fn().mockResolvedValue(undefined);
    const skills = [{ id: "p1", name: "pkg", localPath: "/home/.journeyman/skills/pkg-ab12", enabledSkills: ["alpha"], gitUrl: "", cliType: "claude" }] as any;
    const rewritten = await placeSkills("claude", skills, { materialize });
    expect(materialize).toHaveBeenCalledWith("/workspace/.journeyman/skills", expect.anything());
    expect(rewritten[0].localPath).toBe("/workspace/.journeyman/skills/pkg-ab12");
  });
  it("is a no-op when there are no skills", async () => {
    const materialize = vi.fn();
    const rewritten = await placeSkills("claude", [], { materialize });
    expect(materialize).not.toHaveBeenCalled();
    expect(rewritten).toEqual([]);
  });
});
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `cd packages/orchestrator && npx vitest run src/workers/skill-placement.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `placeSkills`**

```ts
// packages/orchestrator/src/workers/skill-placement.ts
import { bundleEnabledSkills } from "@journeyman/skills";
import type { ResolvedSkillPackage } from "@journeyman/core";

const CLAUDE_SKILLS_DIR = "/workspace/.journeyman/skills";

/**
 * Deliver skills into the container in the layout the provider expects, and
 * return skills with localPath rewritten to the in-container location.
 * Container-path only; for local, callers skip this (skills load from the pantry).
 */
export async function placeSkills(
  provider: string | undefined,
  skills: ResolvedSkillPackage[],
  deps: { materialize: (destDir: string, bundle: import("@journeyman/core").FileBundle) => Promise<void> },
): Promise<ResolvedSkillPackage[]> {
  if (!skills.length) return skills;
  switch (provider ?? "claude") {
    case "claude": {
      const { bundle, mapping } = bundleEnabledSkills(skills, CLAUDE_SKILLS_DIR);
      await deps.materialize(CLAUDE_SKILLS_DIR, bundle);
      const byId = new Map(mapping.map((m) => [m.id, m.containerPath]));
      return skills.map((s) => ({ ...s, localPath: byId.get(s.id) ?? s.localPath }));
    }
    // opencode: .opencode/skills + permission.skill — added in the OpenCode spec
    default:
      return skills;
  }
}
```

- [ ] **Step 4: Run the test to confirm it passes**

Run: `cd packages/orchestrator && npx vitest run src/workers/skill-placement.test.ts`
Expected: PASS.

### Task 19: `custom-ai` handler — demand-driven, place skills (container), fail-loud

**Files:**
- Modify: `packages/orchestrator/src/workers/steps/custom-ai-step-handler.ts`

- [ ] **Step 1: Use `ctx.workspaceDir` for cwd; drop the "no workspaceDir wired" failure**

Replace the `input.workspaceDir` logic with `ctx.workspaceDir` (set by the harness when `needsWorkspace`). Remove the failure block that returned `"...but no workspaceDir input was wired"`.

- [ ] **Step 2: Place skills before running (container path)**

```ts
import { placeSkills } from "../skill-placement.ts";
// ...
let effectiveSkills = skills ?? [];
if (ctx.exec && ctx.materialize && effectiveSkills.length) {
  effectiveSkills = await placeSkills(provider, effectiveSkills, { materialize: ctx.materialize });
}
const coding = ctx.exec ? new SandboxCodingProvider(ctx.exec, provider) : this.deps.coding(provider, ctx.env);
const result = await coding.runCustomPrompt({ /* ... */, skills: effectiveSkills, /* ... */ });
```

- [ ] **Step 3: Fail loud on missing user/org when skills/MCP configured**

Near the top, after reading `userId`/`orgId`:

```ts
const wantsContextResources =
  (Array.isArray(input.skills) && input.skills.length > 0) ||
  (Array.isArray(input.mcps) && input.mcps.length > 0);
if (wantsContextResources && (!userId || !orgId)) {
  return { kind: "failure", failure: { errorClass: "MissingContext", message: "skills/MCP require user/org context on the run", retryable: false } };
}
```

- [ ] **Step 4: Typecheck**

Run: `npm run typecheck`
Expected: passes.

---

## Phase 6 — Workspace steps → `ctx.workspaceDir`; idempotent clone

### Task 20: Idempotent clone

**Files:**
- Modify: `packages/git-provider/src/providers/github/operations/clone-repos.ts`
- Test: `packages/git-provider/src/providers/github/operations/clone-repos.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
it("removes an existing repoDir before cloning (idempotent retry)", async () => {
  // Arrange a workspaceDir with a pre-existing <folder> dir, stub execFileP to assert rm happened first.
  // Assert: clone succeeds (no "already exists" error) on the second call.
});
```

(Use the existing test's mocking style for `execFileP`; assert a pre-clone removal of `repoDir`.)

- [ ] **Step 2: Implement — remove `repoDir` if present, then clone**

Before the `git clone` call:

```ts
import { rm } from "node:fs/promises";
// inside the loop, before execFileP("git", ["clone", ...]):
await rm(repoDir, { recursive: true, force: true });
```

- [ ] **Step 3: Run the test**

Run: `cd packages/git-provider && npx vitest run src/providers/github/operations/clone-repos.test.ts`
Expected: PASS.

### Task 21: Workspace steps use `ctx.workspaceDir`

**Files:**
- Modify: `clone-repos-step-handler.ts`, `list-workspace-files-step-handler.ts`, `start-feature-branch-step-handler.ts`

- [ ] **Step 1: `clone-repos-step-handler.ts`** — replace `const workspaceDir = typeof input.workspaceDir === "string" ? input.workspaceDir : undefined;` with `const workspaceDir = ctx.workspaceDir;` and drop the `!workspaceDir` failure (keep the `!repos` check).

- [ ] **Step 2: `list-workspace-files-step-handler.ts`** — same: use `ctx.workspaceDir`, drop the required-input failure; `scanRepos({ parentDir: ctx.workspaceDir, ... })`.

- [ ] **Step 3: `start-feature-branch-step-handler.ts`** — use repos under `ctx.workspaceDir` (where `input.workspaceDir` was read); drop the required-input failure. Keep `requiresWorkspace = true` for all three.

- [ ] **Step 4: Typecheck**

Run: `npm run typecheck`
Expected: passes.

---

## Phase 7 — Deletions (cascade) + UI removal

### Task 22: Delete `create-workspace` end-to-end + `ICodingCLI.createWorkspace`

**Files (delete/modify):**
- Delete: `packages/steps/src/repos/create-workspace.tsx`, `create-workspace.meta.ts`
- Delete: `packages/orchestrator/src/workers/steps/create-workspace-step-handler.ts`
- Modify: `packages/steps/src/catalog.ts`, `registry.ts` (remove create-workspace entries/imports)
- Modify: `packages/orchestrator/src/index.ts` (remove export), `cli-worker.ts` (remove import + `registry.register(new CreateWorkspaceStepHandler(...))`)
- Modify: `packages/core/src/interfaces/coding-cli.interface.ts` (remove `createWorkspace`), `types/git.types.ts` (remove `CreateWorkspaceOptions/Result`), `types/coding.types.ts` (remove `"createWorkspace"`), `registries/provider-catalog.ts` (remove `"create-workspace"` mapping)
- Modify: `packages/coding-cli/src/providers/{claude,opencode}/index.ts` (remove method + delete `operations/create-workspace.ts`), `gemini/index.ts` + `codex/index.ts` (remove stub method), `runner/dispatch.ts` (remove `"create-workspace"` case), `runner/runner-types.ts` (drop mention)
- Modify: `packages/orchestrator/src/sandbox/sandbox-coding-provider.ts` (remove `createWorkspace`)

- [ ] **Step 1: Remove the interface method and types first**, then delete impls/handlers/steps, then catalog/registry/cli-worker registrations.
- [ ] **Step 2: Grep to confirm no references remain**

Run: `grep -rn "createWorkspace\|create-workspace\|CreateWorkspace\|CREATE_WORKSPACE" packages --include="*.ts" --include="*.tsx" | grep -v node_modules`
Expected: no hits (except possibly historical docs).

### Task 23: Delete `cleanup-workspace` end-to-end + `ICodingCLI.cleanupRepos`

**Files (delete/modify):**
- Delete: `packages/steps/src/repos/cleanup-workspace.tsx`, `cleanup-workspace.meta.ts`
- Delete: `packages/orchestrator/src/workers/steps/cleanup-workspace-step-handler.ts`
- Modify: `packages/steps/src/catalog.ts`, `registry.ts`; `packages/orchestrator/src/index.ts`, `cli-worker.ts`
- Modify: `packages/core/src/interfaces/coding-cli.interface.ts` (remove `cleanupRepos`), `types/git.types.ts` (remove `CleanupReposOptions/Result`), `types/coding.types.ts` (remove `"cleanupRepos"`)
- Modify: `packages/coding-cli/src/providers/{claude,opencode}/index.ts` (remove method + delete `operations/cleanup-repos.ts`), `gemini`/`codex` stubs, `runner/dispatch.ts` (remove `"cleanup-repos"` case)
- Modify: `packages/orchestrator/src/sandbox/sandbox-coding-provider.ts` (remove `cleanupRepos`)

- [ ] **Step 1: Keep `scanRepos`** — verify `list-workspace-files` still imports/uses it.
- [ ] **Step 2: Grep to confirm**

Run: `grep -rn "cleanupRepos\|cleanup-workspace\|CleanupRepos\|CLEANUP_WORKSPACE\|cleanup-repos" packages --include="*.ts" --include="*.tsx" | grep -v node_modules`
Expected: no hits.

### Task 24: Delete `DirectoryWorkspaceProvider`

**Files:**
- Delete: `packages/orchestrator/src/workspace/directory-workspace-provider.ts`
- Modify: `packages/orchestrator/src/index.ts` (remove export), `cli-worker.ts` (remove import + `workspace:` dep), `api-server/src/composition.ts` (remove `new DirectoryWorkspaceProvider()` usage — replace with the worker-owned model or drop if api-server no longer needs it)

- [ ] **Step 1: Remove and fix all references**
- [ ] **Step 2: Grep**

Run: `grep -rn "DirectoryWorkspaceProvider\|IWorkspaceProvider" packages --include="*.ts" | grep -v node_modules`
Expected: only the `@journeyman/core` interface definition may remain (decide whether to keep `IWorkspaceProvider` if unused — remove if fully orphaned).

### Task 25: Remove the `workspaceDir` input requirement + UI (Finding Q)

**Files:**
- Modify: `packages/core/src/validation/validate-for-publish.ts` (remove the `workspaceDir` wiring check, ~`:295-305`)
- Modify: `packages/flow-editor/src/properties-panel/McpToolsTab.tsx` (remove the `:213` nag + `needsWs` usage that drives it)
- Modify: `packages/web/src/components/custom-steps/EditCustomStepModal.tsx` (remove the hint `:276-282`, the "Add required workspaceDir input?" prompt `:351-363`, and the auto-add flow `:54-69`)
- Modify: `packages/web/src/components/custom-steps/InputFieldsEditor.tsx` (remove the `{ value: "workspaceDir", label: "workspaceDir" }` option `:10`)
- Modify: `packages/steps/src/git/clone-repos.meta.ts`, `packages/steps/src/repos/list-workspace-files.meta.ts` (remove the `required: true` `workspaceDir` input field)

- [ ] **Step 1: Apply removals**
- [ ] **Step 2: Grep for stragglers**

Run: `grep -rn "workspaceDir" packages/web packages/flow-editor packages/steps --include="*.ts" --include="*.tsx" | grep -v node_modules`
Expected: no remaining "required workspaceDir input" UI/metas (output refs in docs are fine).

---

## Phase 8 — Verify (typecheck only; do NOT commit)

### Task 26: Per-package tests for touched packages

- [ ] **Step 1: Run tests for the packages we changed**

Run:
```bash
( cd packages/coding-cli && npx vitest run )
( cd packages/workers && npx vitest run )
( cd packages/orchestrator && npx vitest run )
( cd packages/skills && npx vitest run )
( cd packages/git-provider && npx vitest run )
```
Expected: PASS (some docker contract tests may skip without a daemon — that's acceptable).

### Task 27: Full typecheck + import boundaries

- [ ] **Step 1: Typecheck**

Run: `npm run typecheck`
Expected: PASS (no errors).

- [ ] **Step 2: Import boundaries**

Run: `npm run check:boundaries`
Expected: PASS (note: `coding-cli` factory must not import orchestrator; `skill-placement` lives in orchestrator and may import `@journeyman/skills`).

- [ ] **Step 3: Combined check**

Run: `npm run check`
Expected: PASS.

- [ ] **Step 4: Leave everything uncommitted**

Run: `git status`
Expected: modified/created/deleted files listed, **nothing committed**. Stop here — do not `git add`/`git commit`.

---

## Notes / decisions captured from the dry runs

- **Provider key flow** (Job 2) reaches the runner via `RunnerRequest.provider`; the runner builds the provider with `createCodingProvider`.
- **Skills are container-only materialized**; local Claude loads from the pantry path. Placement is **provider-specific** (`placeSkills`) — Claude = package-dir plugin path; OpenCode (later) = `.opencode/skills` + `permission.skill`.
- **Workspace is worker-owned**, demand-driven, status-gated (`provisioning → active`), one builder + `waitActive`. Docker reaped centrally; local reaped per-host + age-TTL, honoring `retainWorkspace`.
- **Removed** `ICodingCLI`: `createWorkspace`, `cleanupRepos`. **Kept**: `scanRepos`, `checkoutRepo`, `runCustomPrompt`.
- **Out of scope** (see TODO.md): OpenCode provider, stdio-MCP delivery, git-clone dedupe, skill-cache refresh race, per-branch workspaces, double-secret-resolution cleanup.
