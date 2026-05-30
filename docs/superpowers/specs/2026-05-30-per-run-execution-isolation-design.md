# Per-Run Execution Isolation Design — Sandboxed Workflow Environments

**Date:** 2026-05-30
**Status:** Draft (pending review)
**Scope:** Give every workflow *instance* (run) a dedicated, isolated execution environment for its workspace-touching steps. First backend is local Docker, behind a pluggable interface so Kubernetes and cloud runners can be added later one by one.

## 1. Goals & Scope

### Why (motivation)
- **Security / multi-tenancy** — runs execute untrusted, AI-generated code (cloned repos, agent-issued Bash). One run must not read another run's files or secrets, nor escape to the host.
- **Reproducible toolchain** — each workflow pins the runtime/tooling it needs (Node, Python, Java, .NET, …) so runs are consistent and independent of the worker host.
- **Filesystem / state isolation** — clean, separate working spaces per run; no collisions on shared paths or global process state.

Resource limits and network controls are *secondary* but included as optional config because they reinforce the security goal.

### Decisions locked during brainstorming
| Decision | Choice |
|---|---|
| Unit of isolation | **One sandbox per workflow instance (run).** Per-step isolation is a later evolution. |
| First backend | **Local Docker**, behind a standard `IExecutionEnvironment` interface. K8s/cloud are future implementations. |
| Where coding work runs | **Inside the sandbox** (Claude Agent SDK + Bash), not on the host. |
| Image model | **Managed image catalog** — a system default base image plus user/org-registered stack images, referenced by id. |
| Execution mechanism | **Approach A** — host worker polls Conductor as today; workspace-touching steps `exec` a runner entrypoint inside the run's container; other steps stay host-side. |
| Runner packaging | **Bundled into the base image, versioned with releases.** |
| Teardown | **Always destroy on terminal state (success or failure)**, plus a reaper and a manual cleanup CLI/API. |
| Config surface | image + optional resource limits + optional network egress policy + optional env/mounts, **all with sane defaults**; isolation is opt-in per workflow. |

### In scope (this spec)
1. `IExecutionEnvironment` interface + types in `@journeyman/core`.
2. New package `@journeyman/execution-env`: `LocalExecutionEnvironment` (passthrough) + `DockerExecutionEnvironment`, sandbox tracking, background reaper.
3. New package/module `@journeyman/execution-images`: catalog table + migration, resolver, CRUD + catalog routes, ≥1 system base image.
4. Base **runner image** (Node + Claude Agent SDK + bundled `@journeyman/coding-cli` + `journeyman-runner` bin), versioned with releases.
5. **Runner entrypoint** extraction in `coding-cli` — operations runnable in-process *or* via stdin/stdout.
6. Worker/orchestrator wiring: run-start provision, `requiresWorkspace` exec routing, per-exec secret injection, run-end teardown.
7. `sandbox` config block in `WorkflowGraph.defaults` + a flow-editor "Environment" section.
8. Manual cleanup: CLI (`sandbox list/prune`) + API (`GET/DELETE/prune`).

### Out of scope (future, same interface)
- Kubernetes and cloud backends (and the C-style long-lived agent for remote `exec`).
- Per-step isolation granularity.
- Base-image + setup-command image *building* (catalog holds managed image refs only).
- Retain-on-failure / TTL retention policy (we chose always-destroy).

## 2. Current Architecture (baseline)

- A single `cli-worker` Node process (`packages/orchestrator/src/cli-worker.ts`) polls Conductor for registered step types. Steps execute **in-process** in the worker.
- `WorkerHarness.processOnce` (`packages/orchestrator/src/workers/worker-harness.ts`) creates a workspace **per step** via `DirectoryWorkspaceProvider` at `{baseDir}/{userId}/{workflowInstanceId}/{nodeId}/`, runs `handler.run(input, ctx)`, then destroys it.
- `StepContext` (`packages/core/src/types/step-handler.types.ts`) carries `workspaceDir`, `env`, `signal`, `log`, etc.
- `ClaudeProvider` operations (`packages/coding-cli/src/providers/claude/operations/*`) call `query()` from `@anthropic-ai/claude-agent-sdk` **in-process**, scoped only by `cwd` + `env`. No process/network/dependency isolation.
- A run instance is **not** a single unit of execution — its steps are independent Conductor tasks any worker can poll.
- Flow definition: `WorkflowGraph` with `defaults?: WorkflowDefaults` (`retry`, `executorConfig`, `defaultModel`) at flow level; per-node `config`, `executorConfig`, `model`, `retry`, `secretBindings` (`packages/core/src/types/flow.types.ts`).
- Existing registry precedent: `@journeyman/mcp` — DB-backed, user/org-scoped CRUD + visible-list + static catalog + resolver. We mirror it.

## 3. Core Abstraction — `IExecutionEnvironment`

Lives in `@journeyman/core` (which never imports other `@journeyman/*` packages). Implementations live in `@journeyman/execution-env`.

```ts
// packages/core/src/types/execution-environment.types.ts

export interface ExecutionEnvironmentSpec {
  imageRef: string;                          // resolved from the managed image catalog
  env?: Record<string, string>;              // non-secret env; default: none
  resources?: { cpus?: number; memoryMb?: number; timeoutSec?: number };
  network?: "none" | "restricted" | "full"; // default: "restricted"
  mounts?: { source: string; target: string; readOnly?: boolean }[];
}

export interface ProvisionedEnv {
  runId: string;
  backend: string;        // "local" | "docker" | future
  handle: string;         // container id (docker) / opaque handle
  volume?: string;        // named run volume
}

export interface ExecOp {
  op: string;                       // "analyze" | "plan" | "implement" | "custom-prompt" | git ops
  stdin: unknown;                   // JSON request envelope (see §6)
  env?: Record<string, string>;     // per-exec secrets, injected at exec time only
  signal?: AbortSignal;
  onLog?: (line: string) => void;   // forwarded from runner stderr → StepContext.log
}

export interface ExecResult {
  ok: boolean;
  structured?: unknown;
  error?: string;
}

export interface IExecutionEnvironment {
  readonly backend: string;
  provision(runId: string, spec: ExecutionEnvironmentSpec): Promise<ProvisionedEnv>;
  exec(env: ProvisionedEnv, op: ExecOp): Promise<ExecResult>;
  destroy(env: ProvisionedEnv): Promise<void>;
  list(filter?: { runId?: string; orphanedOnly?: boolean }): Promise<ProvisionedEnv[]>;
}
```

Implementations:
- **`LocalExecutionEnvironment`** — the default "no isolation" backend. `provision`/`destroy` are no-ops; `exec` calls the operation function **in-process**, preserving today's behavior exactly. This is what runs when a workflow has no sandbox configured.
- **`DockerExecutionEnvironment`** — first real backend. `provision` = `docker run -d` an idle container from `imageRef` + create a named volume; `exec` = `docker exec -i` the runner; `destroy` = `docker rm -f` container + `docker volume rm`; `list` = enumerate by the `journeyman.runId` label.
- K8s / cloud — future classes implementing the same interface (`kubectl exec` / ECS `execute-command`; the C-style network agent where remote `exec` is unavailable).

## 4. Managed Image Catalog — `@journeyman/execution-images`

Mirrors `@journeyman/mcp` (DB-backed, user/org scoped, CRUD + visible-list + catalog + resolver).

```ts
ExecutionImage {
  id,
  scope: "user" | "org" | "system",   // system = built-in defaults
  name,                                // "Java 21 stack", ".NET 8 stack"
  imageRef,                            // "myorg/jm-runner:java21"
  description,
  defaults?: { resources?, network?, env? },  // optional per-image defaults
  createdBy, createdAt, updatedAt
}
```

- **System images:** at least one default base runner — Node + Claude Agent SDK + the `journeyman-runner` entrypoint preinstalled (§6). Fallback when a workflow specifies no image.
- **User/org images:** users register their own stack images. **Hard contract (documented):** any custom image *must* contain the Journeyman runner entrypoint + Node SDK, or coding steps cannot execute inside it. Custom images are expected to `FROM journeyman/runner-base:<version>` then add their toolchain.
- **Routes** (Fastify, mirroring MCP): `GET /execution-images` (visible = system ∪ user ∪ org), `POST/PATCH/DELETE` for user/org scopes, `GET /execution-images/catalog` (system catalog).
- **Resolver:** `resolveExecutionImage(imageId, { userId, orgId }) → { imageRef, defaults }`, consumed by the worker/orchestrator at provision time (same shape as `resolveMcpInstances`).
- **DB:** one append-only migration adding an `execution_images` table. Read `docs/constitution/DATABASE_ARCHITECTURE.md` before authoring it.

Workflows reference an image **by id**, never a raw `imageRef`, so the catalog stays the single source of truth and images can be rotated centrally.

## 5. Workflow-Level Config

The sandbox is a run-level concern, so config lives in `WorkflowGraph.defaults` (`packages/core/src/types/flow.types.ts`), not per-node.

```ts
// added to WorkflowDefaults
sandbox?: {
  enabled: boolean;               // default false → LocalExecutionEnvironment (today's behavior)
  backend?: "docker";             // default "docker" when enabled; future: "kubernetes" | "cloud"
  imageId?: string;               // → managed image catalog; omitted = system default base image
  resources?: { cpus?: number; memoryMb?: number; timeoutSec?: number };
  network?: "none" | "restricted" | "full";   // default "restricted"
  env?: Record<string, string>;                // non-secret; merged over image defaults
  mounts?: { source: string; target: string; readOnly?: boolean }[];
}
```

**Resolution precedence** (worker resolves at run start): per-workflow `sandbox.*` → image catalog `defaults` → system defaults. A workflow can set only `{ enabled: true, imageId }` and inherit sane defaults for everything else.

**Backward compatibility (critical safety property):** `sandbox` absent or `enabled: false` → `LocalExecutionEnvironment` → existing in-process behavior unchanged. Isolation is strictly opt-in per workflow; no current flow changes behavior.

**Flow-editor UI:** a new "Environment" section in the **flow-level** settings panel (parallel to existing flow-level defaults), not the per-node panel. Controls: `enabled` toggle, image picker (from catalog), and an "advanced" expander for resources / network / env / mounts. Match existing flow-level-defaults UI patterns.

## 6. Runner Image + Entrypoint (Approach A core)

Today `ClaudeProvider` operations call `query()` in-process. We extract *single-operation execution* into a runner binary that runs **either** in-process (local backend) **or** inside the container (docker backend) — identical logic, different location.

**Runner entrypoint** (`@journeyman/coding-cli/runner` → `journeyman-runner` bin baked into every image):
- Invoked as `journeyman-runner <operation>` where operation ∈ `analyze | plan | implement | custom-prompt | clone | scan | reset | …`.
- Reads a JSON request on **stdin**: `{ prompt, options, schema, cwd, env, mcps }`.
- Runs the *existing* operation logic from `providers/claude/operations/` (including `query()` and `logSdkMessage`) inside the container, with `cwd` = the mounted run volume (`/workspace`).
- Writes a result envelope to **stdout**: `{ ok: true, structured } | { ok: false, error }`.
- Streams SDK log lines on **stderr**, forwarded by the host to `StepContext.log`.

**Host-side dispatch boundary** in `ClaudeProvider`:
```
ClaudeProvider.analyze(opts)
  └─ sandboxed run?  env.exec(provisionedEnv, { op: "analyze", stdin: request, env: secrets })
                      → parse stdout envelope → return structured
     local backend?  run operation in-process exactly as today
```
For Docker, `exec` = `docker exec -i <container> journeyman-runner analyze` with the JSON request piped to stdin and secrets passed via `-e` at exec time. For local, `exec` calls the operation function directly — which is why current flows are untouched.

**Image contract (concrete form of §4's requirement):** image must have Node + `@anthropic-ai/claude-agent-sdk` + `journeyman-runner` on `PATH`. The base runner image **bundles a build of `@journeyman/coding-cli` and its deps**, is published/versioned with each Journeyman release (so host/runner protocol always matches), and custom stack images inherit it via `FROM journeyman/runner-base:<version>`.

This `exec(op, stdin) → stdout` primitive is exactly what K8s (`kubectl exec`) and ECS (`execute-command`) expose later, and the stdio envelope is the same protocol a future network agent would speak.

## 7. Execution Boundary — In-Sandbox vs Host-Side

The boundary: **does the step touch the run's workspace or execute untrusted/AI-generated code?**

**In-sandbox (routed through `exec`):**
- `clone-repos` and local git ops (`scan`, `checkout`, `reset`, `commit`) — they write the untrusted repo into the run volume.
- `analyze` / `plan` / `implement` / `custom-ai` — they run the Claude SDK with Bash against that repo. This is the surface the design exists for.

**Host-side (unchanged):**
- `getTicket` (Jira/Linear/GitHub Issues), `createPR`/`createMR` via `git-provider` REST, Slack notifications — remote API calls that don't touch the workspace and need host network/credentials. Sandboxing them adds egress/secret complexity for no isolation benefit.

**How a step declares its lane:** each step handler sets a declarative flag at registration — `requiresWorkspace: true` (analogous to existing `retryable` / `tabs` flags). When `true` **and** the run has a sandbox, the worker dispatches that step's coding-cli operation through `IExecutionEnvironment.exec`; otherwise it runs in-process as today.

**Secrets / env at exec time:** `secretBindings` continue to resolve into `StepContext.env`. For sandboxed steps, resolved secret values are passed as `-e` flags on the `docker exec` invocation (process env of that exec only) — **never** baked into the image, the container's persistent env, or the volume. Workflow-level `sandbox.env` (non-secret) is set once at provision; secrets are injected per-exec and vanish with the exec process. Network egress (`none`/`restricted`/`full`) is enforced at provision via Docker network mode.

**Workspace continuity:** for sandboxed runs, a per-run **named volume** mounted at a fixed path (`/workspace`) replaces the per-step temp dir, so `StepContext.workspaceDir` inside the runner is always `/workspace` and state persists across the run's steps. For non-sandboxed runs, `DirectoryWorkspaceProvider` behavior is untouched.

## 8. Lifecycle, Tracking & Cleanup

**Provision (run start):** in the orchestrator run-creation path (`ConductorOrchestrator.submit` / run-start hook): resolve `sandbox` config → resolve `imageId` via the catalog → `IExecutionEnvironment.provision(runId, spec)` → idle container + named volume `jm-run-<runId>`, labeled `journeyman.runId=<runId>` and `journeyman.owner=<userId/orgId>`. Record a row in a new **`sandbox_instances`** table: `{ runId, backend, handle, volume, imageRef, status, createdAt }`.

**Per step:** worker looks up the run's `ProvisionedEnv` (from `sandbox_instances` by `runId`) and routes `requiresWorkspace` steps through `exec` against the shared `/workspace` volume.

**Teardown (always, on terminal state):** on run completion **and** failure (Conductor run-complete hook), `destroy()` removes container + volume and marks the `sandbox_instances` row `destroyed`.

**Crash safety — two layers:**
1. **Background reaper** (periodic, in the worker harness): list Docker resources by `journeyman.runId` label, cross-check against active runs; destroy anything whose run is terminal/unknown (orphaned by a crashed worker/orchestrator). Same loop reconciles `sandbox_instances` rows stuck non-terminal past a TTL.
2. **Manual cleanup:** CLI `journeyman sandbox list` / `journeyman sandbox prune [--runId <id> | --all-orphans]`, and API `GET /sandboxes`, `DELETE /sandboxes/:runId`, `POST /sandboxes/prune`. Lists leftovers (labels ∪ `sandbox_instances`), shows orphans, force-destroys on demand.

Both reaper and manual cleanup go through `IExecutionEnvironment.list/destroy`, so they work for any backend.

## 9. Testing Strategy

- **`IExecutionEnvironment` contract tests** — shared suite run against both `Local` and `Docker` backends (provision → exec → destroy → list lifecycle); future backends reuse it.
- **Runner entrypoint** — unit tests for the stdin→operation→stdout envelope (success, operation error, malformed input), SDK `query()` mocked. Verifies the host/runner protocol both directions.
- **Docker backend (integration, gated)** — real `docker run/exec/rm` against the base runner image; label/volume lifecycle; network-mode enforcement; resource flags. Tagged to run only where Docker is available.
- **Image catalog** — resolver precedence + CRUD route tests, mirroring `@journeyman/mcp`.
- **Reaper / manual prune** — orphan detection for a crashed-worker scenario (labeled resources, no active run) + `sandbox_instances` reconciliation.
- **Backward-compat regression** — a flow with `sandbox` absent/`enabled:false` runs through the local backend identically to today.

## 10. Build Order (suggested)

1. `IExecutionEnvironment` interface + types in `core`; `LocalExecutionEnvironment` passthrough; route `requiresWorkspace` steps through it (local) with zero behavior change.
2. Runner entrypoint extraction in `coding-cli` (in-process path first).
3. `@journeyman/execution-images` catalog (table + migration + resolver + routes) + a system base image record.
4. Base runner image (bundled coding-cli + SDK + `journeyman-runner`).
5. `DockerExecutionEnvironment` + `sandbox_instances` table + provision/teardown wiring.
6. `sandbox` config in `WorkflowGraph.defaults` + flow-editor "Environment" section.
7. Reaper + manual cleanup CLI/API.

Each step keeps `npm run check` (typecheck + import boundaries) green.
