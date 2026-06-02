# Dynamic Coding Provider + Environment-Owned Workspace + Container Skill Delivery — Design Spec

**Date:** 2026-06-01
**Author:** Samuel Rego
**Status:** Draft — pending review

---

## 1. Goal

Make the coding provider **dynamic** instead of hardcoded to Claude, so any provider (Claude today, OpenCode/others later) can be selected and runs **wherever the SDK runs** — in-process or inside a Docker container (local, remote, or cloud).

Alongside this:
- Ensure **skills, MCP, secrets, and inputs** flow to the selected provider in *both* execution paths — including fixing the gap where **skill files never reach the container** (skills silently load as zero there).
- Make the **execution environment own the workspace**: each run gets one isolated workspace, created and destroyed automatically. This removes the explicit `create-workspace` / `cleanup-workspace` steps and the mandatory `workspaceDir` input wiring.

This is a **provider-agnostic foundation**. Implementing the OpenCode provider itself is a *separate, follow-up* effort that plugs into this seam.

---

## 2. Background — current state

### Two execution paths
The `custom-ai` step picks one of two paths ([custom-ai-step-handler.ts:154](../../../packages/orchestrator/src/workers/steps/custom-ai-step-handler.ts)):
- **In-process** (`ctx.exec` null): the worker builds a provider and runs the SDK in its own process.
- **Container** (`ctx.exec` set): `SandboxCodingProvider` ships each operation as JSON into a Docker container, where the `journeyman-runner` CLI builds a provider and runs the SDK *inside the container*.

### Two hardcoded provider-construction sites
- In-process factory — a Claude-only `switch` in [cli-worker.ts:68](../../../packages/orchestrator/src/cli-worker.ts).
- Container runner — `new ClaudeProvider(...)` hardcoded in [runner/cli.ts](../../../packages/coding-cli/src/runner/cli.ts), which never receives the provider key.

### The skill-file gap
Skills are git-cloned to the **worker host** at `~/.journeyman/skills/<name>-<hash>`. The resolved `localPath` is a host path.
- **In-process:** SDK runs on the same machine → `existsSync(localPath)` true → skills load. ✅
- **Container:** only the per-run volume is mounted at `/workspace`. The host skills path doesn't exist inside the container, so [sdk-adapter.ts:13](../../../packages/skills/src/sdk-adapter.ts) (`if (!existsSync) continue;`) silently skips every skill → **zero skills load**, no error. ❌

### The workspace today (the key finding)
There are two unrelated "workspace" notions, which is the source of confusion:
- **Wired `workspaceDir`** — produced by the explicit **`create-workspace`** step and threaded through the flow graph as `input.workspaceDir`. This is the *real* shared working directory: `clone-repos`, `custom-ai`, `list-workspace-files`, `cleanup-workspace` all **require** it.
- **Harness `ws`** — `workspace.create({ ...nodeId })` makes a **per-node** dir and **destroys it at the end of every step** ([worker-harness.ts:132](../../../packages/orchestrator/src/workers/worker-harness.ts) + `ws.destroy()` at [:368](../../../packages/orchestrator/src/workers/worker-harness.ts)). It is throwaway scratch — *not* used by the coding/clone handlers (they use the wired input).

So the explicit `create-workspace` step is **load-bearing today**, not redundant. The clean fix is to make the **execution environment** own a single per-run workspace (it already does in the container: the `/workspace` volume), and have all steps use it — then both the explicit steps and the `workspaceDir` wiring become unnecessary.

### What already flows correctly
Skills (as data), MCP, secrets (`env`), and inputs (rendered into the prompt) already travel through both paths. Secrets arrive as container env vars. Missing: the provider key (container path) and the skill files (container path).

---

## 3. Scope

### In scope
1. **Job 1 — Dynamic provider factory** (removes the hardcoded duplication).
2. **Job 2 — Carry the provider key into the container.**
3. **Job 3 — Deliver skill files into the container** via a generic, backend-pluggable capability.
4. **Job 4 — Environment-owned per-run workspace**, replacing explicit workspace steps and `workspaceDir` wiring.

### Out of scope
- Implementing the OpenCode provider — separate spec.
- Gemini/Codex implementations.
- stdio-MCP binary delivery into the container (HTTP/SSE MCP works; stdio noted in [TODO.md](../TODO.md)).
- `git clone` dedupe between `git-provider` and the runner `clone` op (see [TODO.md](../TODO.md)).
- Migrating old DB flow data (per decision: ignore old data).
- Per-step (vs per-run) workspace isolation — default is one workspace per run; per-step is a possible future worker option.

---

## 4. Design

### Job 1 — Dynamic provider factory

**New:** `packages/coding-cli/src/providers/factory.ts`

```ts
export function createCodingProvider(
  key: string | undefined,
  opts: { env: Record<string, string>; model?: string },
): ICodingCLI {
  switch (key ?? "claude") {
    case "claude":
      return new ClaudeProvider({ apiKey: opts.env.ANTHROPIC_API_KEY });
    // future providers add one case here
    default: {
      const err = new Error(`Unknown coding provider: ${key}`) as Error & { name: string };
      err.name = "ConfigurationError";
      throw err;
    }
  }
}
```

Exported from `packages/coding-cli/src/index.ts`.

**Edits:**
- [cli-worker.ts:68-78](../../../packages/orchestrator/src/cli-worker.ts) — replace the inline `switch` with `createCodingProvider(key, { env })`.
- [runner/cli.ts](../../../packages/coding-cli/src/runner/cli.ts) — replace `new ClaudeProvider(...)` with `createCodingProvider(req.provider, { env: process.env })`.

### Job 2 — Carry the provider key into the container

- **core** — add `provider?: string` to `ExecOp` ([execution-environment.types.ts](../../../packages/core/src/types/execution-environment.types.ts)).
- **runner-types** — add `provider?: string` to `RunnerRequest`.
- **SandboxCodingProvider** — accept the provider key and set `provider` on every `ExecOp`. The handler constructs it as `new SandboxCodingProvider(ctx.exec, provider)`.
- **DockerExecutionEnvironment.exec** — include `op.provider` in the JSON request.
- **run-cli.ts / cli.ts** — read `req.provider`, pass to `createCodingProvider`.

Secrets/MCP/skills(data)/inputs already flow — no change.

> Multi-provider note: the sandbox is provisioned **per run**, so two custom-ai steps with different providers share one container. The runner image must therefore contain **every provider's SDK/binary** (Claude SDK today; `opencode` binary when added). The factory selects per request.

### Job 3 — Generic skill-file delivery into the container

#### 3a. Generic capability on `IExecutionEnvironment` (core)
```ts
materialize(env: ProvisionedEnv, destDir: string, bundle: FileBundle): Promise<void>;
```
`FileBundle` = a streamable tar (content, not host paths) so backends without a shared filesystem still work. Skills are the first consumer.

#### 3b. Per-backend implementations
| Backend | `materialize` |
|---|---|
| `local` | copy into the workspace dir (same FS) |
| `docker` | `putArchive` (tar over the Docker Engine API) — local / remote / VM / EC2 / Docker-Desktop-Windows |
| future `ecs` / `k8s` | own mechanism (EFS / S3+init / exec-write); plugs in without touching skills or provider code |

**Docker client** — add `putArchive(containerId, tarStream, { path })` to `IDockerClient` + `DockerodeClient`.

> `putArchive` covers every environment running a Docker daemon. It does not cover ECS/Fargate/K8s — but neither does the rest of `DockerExecutionEnvironment`; those get a dedicated backend later, and `materialize` lets them slot in with no changes here.

#### 3c. Skill bundling helper
**New** `packages/skills/src/bundle-skills.ts`: `bundleEnabledSkills(skills) → { bundle: FileBundle; mapping }` — reads the enabled skill package folders from the worker disk, packs them into a tar, and returns the in-container path mapping.

#### 3d. Wiring in custom-ai (container path only) — provider-specific placement
`materialize` is a **generic primitive** ("put these files here"). **Where** skills go and **how** the provider is pointed at them is **provider-specific** — a small per-provider step on the worker (it has the provider key from Job 2), layered on `materialize`. Same pattern as `createCodingProvider` / per-provider `sdk-adapter`.

- **Claude (this spec):** Claude loads skills as **plugins** — `{ type: "local", path: <package root> }`. So:
  1. Bundle the enabled skill **package dir(s)** (the repo root with its `skills/`/`.claude-plugin/` structure), not loose `SKILL.md` files.
  2. `materialize` them into the container (e.g. `/workspace/.journeyman/skills/<package>`), wiping first (per-step reset).
  3. Rewrite each `skills[].localPath` to the **materialized package root** so `toSdkPluginConfigs`' `existsSync` succeeds and the plugin loads.
- **OpenCode (deferred to its spec):** different placement — its native `.opencode/skills/` discovery folder + `permission.skill` gating. **Not** `.claude/skills` (OpenCode reads that only for Claude-compat; misleading name). See [TODO.md](../TODO.md).

In-process path unchanged — local Claude loads from the pantry `localPath` directly (no materialize needed; container-only).

#### 3e. Per-step isolation in a shared (workflow-level) worker
The worker/sandbox is provisioned **per run** (`jm_sandbox_instances WHERE run_id`) and chosen at the **workflow level** (`defaults.workerId`; per-step override only for workspace-independent steps). Skills/MCP are configured **per step**. Multiple custom-ai steps in one run therefore share one container. **Each step must see only its own skills/MCP** — no bleed-through from a previous step. This is guaranteed by delivering per-step config at execution time and scoping it to that step:

- **MCP — isolated by construction.** Each step runs as a **separate `journeyman-runner` process** (a fresh `docker exec`). MCP is passed only in that step's request and injected into that single `query()`/prompt call. No MCP state persists in the container between steps, so step 1's MCP cannot reach step 2.
- **Skills — per-step reset (not accumulation).** Before each custom-ai step runs, the skills staging dir (provider-specific — for Claude `/workspace/.journeyman/skills`; see §3d) is **cleared and re-materialized with only that step's resolved skills**. The repo/code in the workspace is untouched; only the skills staging is rebuilt. This guarantees each step's skill folder contains exactly its own set — correct for both explicit-`localPath` loading (Claude) and directory discovery (OpenCode). Cleared again / destroyed with the workspace at run end (Job 4).
- **Secrets:** resolved per step, passed as env on that step's exec.

#### 3f. Fail loud on missing run context
Today, if a step has `skillPackageIds`/`mcpInstanceIds` configured but the run lacks `userId`/`orgId`, MCP/skills resolve to **empty silently** ([worker-harness.ts:203,232](../../../packages/orchestrator/src/workers/worker-harness.ts)) — the skill/MCP just never applies, with no feedback. Change this: when a step **has** skills/MCP configured but `userId`/`orgId` is missing, **fail the step with a clear error** (or at minimum emit a loud `step.log` warning), instead of silently dropping them. **Also covers provisioning (F):** `resolveWorker` needs `userId`/`orgId` to pick the worker/image — if a workspace-needing step lacks them, fail loud with the same clear message ("missing user/org context") rather than silently mis-provisioning.

#### 3g. Contract test
Extend the shared `IExecutionEnvironment` contract test ([backends/contract.ts](../../../packages/workers/src/backends/contract.ts)) with a `materialize` case (local + docker).

### Job 4 — Environment-owned per-run workspace (unified local + docker)

**Principle:** the **execution environment** owns **one workspace per run**, created at run start and destroyed at run end. All steps share it. No explicit step, no wired `workspaceDir`. **One workspace abstraction and one lifecycle for both local and docker** — collapsing today's overlapping folder-creators.

**Single owner: the worker owns the workspace lifecycle for *both* local and docker.** The worker can manage both (it already builds a Docker client *and* it's the machine with the local disk), so there is **one mental model**: *the worker sets up and tears down its own workspace, whatever the type.* The api-server no longer owns workspaces (it may optionally pre-warm a Docker container early as a latency optimization, but it is not the owner).

- **Demand-driven:** provisioning is requested **per step, only when the step actually needs a workspace** (`toolsRequireWorkspace(tools)` true). A pure-LLM step (no workspace tools) provisions nothing and runs in-process even on a docker worker. Replaces the static `CustomAiStepHandler.requiresWorkspace = true` with a runtime decision (the handler asks for the workspace when it determines it needs one).
- **Provision (lazy, on first step that needs a workspace):**
  - Resolve the run's worker (`workerId`). If a sandbox/workspace record already exists for this run → **connect** to it (read the record); else → **create it and record it** (provision-if-missing, guarded against two workers racing via an upsert/lock on the run id).
  - **local** → `LocalExecutionEnvironment` makes `<base>/<runId>` on the worker's disk.
  - **docker** → create/connect the container via the Docker daemon (`makeDockerClient`, the worker already does this to read sandboxes today); the `/workspace` volume is the workspace.
- **Use — two clean execution paths:** **docker** ships each op into the container (`SandboxCodingProvider`, exposing `ctx.exec` + `ctx.materialize`); **local** runs the provider **directly in-process** (built via `createCodingProvider`) and only borrows `ctx.workspaceDir` from the env (no serialize-to-self; keeps live logs/abort simple; local needs no `materialize`). Either way, all of a run's steps share the one workspace.
- **Cleanup (at run end):** a reaper checks for finished runs and tears the workspace down. Docker can be destroyed by anyone holding the recorded daemon connection; a **local** dir can only be removed **on the worker host that owns it**, so local cleanup runs worker-side (a per-host sweep / crash-safe age-TTL). Either way the workspace is **worker-owned**. **Honor the existing `retainWorkspace` local-worker flag (Finding S)** ([LocalConfigForm.tsx](../../../packages/web/src/components/workers/types/LocalConfigForm.tsx); already respected by `LocalExecutionEnvironment.destroy`) — when set, skip cleanup (debugging).
- **Retire `DirectoryWorkspaceProvider`** — the harness no longer creates a per-node dir; it uses the worker-owned per-run workspace for both types. (Resolves the `DirectoryWorkspaceProvider` vs `LocalExecutionEnvironment` duplication and the redundant per-node-per-step dir.)

**Why worker-owned (the underlying reason):** a Docker workspace is remotely manageable (over the daemon API), but a local workspace is *just a folder on one machine* and can only be created/removed **on that machine**. The worker is the one component that can do both — so making it the single owner is what keeps the model consistent.

**Constraint (documented, no code):** a `local` workspace lives on **one host**; multi-worker local needs a shared filesystem. **Docker is the multi-worker/distributed path.**

**Concurrency & retry (from the worker-owned dry run):**
- **One builder, others wait (A):** `ensureWorkspace` uses an **insert-if-absent** on the run id to elect exactly one builder; the record carries a status `provisioning → active`. The builder provisions then flips to `active`; other workers (e.g. parallel fork branches) **wait/poll until `active`** with a timeout. (`LISTEN/NOTIFY` is an optional push-based upgrade over polling.)
- **Status owner + watchdog (C):** the **worker** sets `provisioning`/`active`; the existing stuck-provisioning **watchdog stays a DB-scan** (api-server is fine) but watches the **record's** flag — stuck past timeout → fail run/step + clean up. Same timeout serves A's wait.
- **Idempotent clone on retry (E):** clone must **remove `repoDir` if it already exists, then clone fresh** — today a plain `git clone` into a leftover dir from a failed attempt fails the retry. Do **not** wipe the whole workspace on retry (preserves other steps' work).
- **Parallel-write & local-orphan constraints (B, D):** document — parallel branches shouldn't write the same workspace files; local cleanup is per-host with an age-TTL backstop for crashed workers.

**Then:**
- **Expose the run workspace as `ctx.workspaceDir`** (from the provisioned env) and stop creating/destroying a per-step dir.
- **All workspace-touching steps use `ctx.workspaceDir`** instead of requiring `input.workspaceDir`:
  - `custom-ai` ([custom-ai-step-handler.ts](../../../packages/orchestrator/src/workers/steps/custom-ai-step-handler.ts)) — use `ctx.workspaceDir` for cwd; drop the "no workspaceDir wired" failure.
  - `clone-repos` ([clone-repos-step-handler.ts](../../../packages/orchestrator/src/workers/steps/clone-repos-step-handler.ts)) — clone into `ctx.workspaceDir`; drop the required input.
  - `list-workspace-files` ([list-workspace-files-step-handler.ts](../../../packages/orchestrator/src/workers/steps/list-workspace-files-step-handler.ts)) — `scanRepos(ctx.workspaceDir)`; drop the required input.
  - `start-feature-branch` ([start-feature-branch-step-handler.ts](../../../packages/orchestrator/src/workers/steps/start-feature-branch-step-handler.ts)) — operate on repos under `ctx.workspaceDir`; drop the required input.
- **`requiresWorkspace` flag (Finding O):** `clone-repos`, `list-workspace-files`, `start-feature-branch` **always** need a workspace → keep `requiresWorkspace = true`. Only `custom-ai` is **demand-driven** (workspace only if its tools require it). "Demand-driven" is custom-ai-only, not all steps.
- **Delete `create-workspace`** (environment makes the workspace) and **`cleanup-workspace`** (environment destroys it at run end) end-to-end.
- **Remove the `workspaceDir` input requirement + UI/validation:**
  - publish check ([validate-for-publish.ts:295](../../../packages/core/src/validation/validate-for-publish.ts)).
  - UI nags + workspaceDir-input machinery (Finding Q — broader than first listed): [McpToolsTab.tsx:213](../../../packages/flow-editor/src/properties-panel/McpToolsTab.tsx) ("wire a workspaceDir input"); in [EditCustomStepModal.tsx](../../../packages/web/src/components/custom-steps/EditCustomStepModal.tsx) — the hint (`:276`), the "Add required workspaceDir input?" prompt (`:351`), **and the auto-add-workspaceDir-input flow** (`:54–69`); and the `workspaceDir` field-type option in [InputFieldsEditor.tsx:10](../../../packages/web/src/components/custom-steps/InputFieldsEditor.tsx).
  - `required: true` `workspaceDir` fields in step metas: `clone-repos.meta.ts`, `list-workspace-files.meta.ts` (the `cleanup-workspace.meta.ts` / `create-workspace.meta.ts` files are deleted with their steps).

**Deletion blast radius (create-workspace + cleanup-workspace):**
| Package | Remove |
|---|---|
| core | `createWorkspace` **and `cleanupRepos`** (both orphaned — Finding K) from `coding-cli.interface.ts`; `CreateWorkspaceOptions`/`Result` + `CleanupReposOptions`/`Result` in `git.types.ts`; `"createWorkspace"` + `"cleanupRepos"` in `coding.types.ts`; `"create-workspace"` in `provider-catalog.ts`. **Keep `scanRepos`** (still used by `list-workspace-files`) + `checkoutRepo`. |
| coding-cli | claude + opencode `operations/create-workspace.ts` + `cleanup-repos.ts` + index methods; gemini/codex stub methods (both); `dispatch.ts` `"create-workspace"` + `"cleanup-repos"` cases; `runner-types.ts` mentions |
| steps | `repos/create-workspace.{tsx,meta.ts}`, `repos/cleanup-workspace.{tsx,meta.ts}`; remove from `catalog.ts` + `registry.ts` |
| orchestrator | `create-workspace-step-handler.ts`, `cleanup-workspace-step-handler.ts`; `index.ts` exports; `cli-worker.ts` imports + registrations; `sandbox-coding-provider.ts` `createWorkspace` + `cleanupRepos` methods |

---

## 5. Data / interface changes summary

| Type/Interface | Change |
|---|---|
| `ICodingCLI` | remove `createWorkspace` **and `cleanupRepos`** (orphaned); keep `scanRepos`, `checkoutRepo`, `runCustomPrompt` |
| `ExecOp` | add `provider?: string` |
| `RunnerRequest` | add `provider?: string` |
| `IExecutionEnvironment` | add `materialize(env, destDir, bundle)`; workspace lifecycle becomes per-run |
| `StepContext` | add `materialize(destDir, bundle)` alongside `exec` — `sandboxResolver` returns the env (both `exec` + `materialize`), wired for local and docker |
| `FileBundle` | new type (streamable tar) |
| `IDockerClient` | add `putArchive(...)` |
| Step metas | drop `required` `workspaceDir` inputs |

---

## 6. Testing

- **Unit:** `createCodingProvider` selection + unknown-key error; `bundleEnabledSkills` tar + path mapping; skill `localPath` rewrite.
- **Docker client:** `putArchive` streams a tar into a container.
- **Contract:** `materialize` case for `local` + `docker`; per-run workspace persists across `exec` calls and is removed on `destroy`.
- **End-to-end:** `custom-ai` in the container with a skill that runs a `scripts/` file — confirm it loads/executes (previously zero). A `clone → custom-ai` flow shares one workspace with **no** explicit workspace step and **no** wired `workspaceDir`. Provider key reaches the runner.
- **Regression:** existing flows still run; publish no longer demands `workspaceDir`; build/typecheck/`check:boundaries` pass after deletions.

---

## 7. Files changed (summary)

**New:** `coding-cli/src/providers/factory.ts`; `skills/src/bundle-skills.ts`.
**Modified — dynamic provider:** `cli-worker.ts`, `runner/cli.ts`, `runner/run-cli.ts`, `runner-types.ts`, `sandbox-coding-provider.ts`, `docker-execution-environment.ts`, core `ExecOp`.
**Modified — skill delivery:** core `IExecutionEnvironment` + `FileBundle`, `docker-client.ts`, `docker-execution-environment.ts`, `local-execution-environment.ts`, `custom-ai-step-handler.ts`, `backends/contract.ts`.
**Modified — workspace (worker-owned, Option B):** worker `sandboxResolver` / `cli-worker.ts` gains **provision-if-missing** for both local and docker (records the sandbox/workspace, guarded against races) — this requires `cli-worker.ts` to import `resolveWorker` / `resolveDockerSpec` / `recordSandbox` from `@journeyman/workers` and read `JOURNEYMAN_RUNNER_BUNDLE` (Finding R — today only the api-server has these); api-server `composition.ts` provisioning becomes **optional pre-warm** (or removed) and the reaper gains a **local** destroy path / worker-host sweep; `worker-harness.ts` (uses provisioned `ctx.workspaceDir`, stops per-step create/destroy); **delete** `directory-workspace-provider.ts`; `clone-repos-step-handler.ts`, `list-workspace-files-step-handler.ts`, `validate-for-publish.ts`, `EditCustomStepModal.tsx`, `McpToolsTab.tsx`, `clone-repos.meta.ts`, `list-workspace-files.meta.ts`.
**Deleted:** `create-workspace` and `cleanup-workspace` steps end-to-end (see §4 blast radius).

---

## 8. Supersedes

The stale [2026-04-20 OpenCode provider spec](2026-04-20-opencode-provider-design.md). The OpenCode provider gets a fresh spec built on this foundation.
