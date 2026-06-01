# Workers — Managed Compute Targets (with Per-Run Isolation)

**Date:** 2026-05-30
**Status:** Draft (pending review)
**Scope:** Introduce a first-class **Worker** concept — a managed, named, configurable *compute target* (managed on its own page, associated to workflows) that decides **where** and **how** a workflow's steps execute. The first concrete worker is **Docker, per-instance, push** — which delivers the original per-run isolation goal. Other worker types (machines, ECS, EC2, Kubernetes, cloud) plug in later behind the same interface.

> **Naming note:** "**Worker**" in this document means the managed *compute target*. The existing Conductor-polling process (`packages/orchestrator/src/cli-worker.ts`) is referred to throughout as the **"worker harness"** to avoid collision.

## 1. Goals & Scope

### Why (motivation)
- **Security / multi-tenancy** — runs execute untrusted, AI-generated code (cloned repos, agent-issued Bash). One run must not read another run's files/secrets nor escape to the host.
- **Reproducible toolchain** — each workflow runs on a pinned environment (Node/Python/Java/.NET/…), independent of the host running Journeyman.
- **Filesystem / state isolation** — clean, separate working spaces per run.
- **Operator control over compute** — a managed way to define *where* runs execute (local Docker now; machines/clouds later) and associate that to workflows, like GitLab/GitHub runners.

Resource limits and network controls are secondary but included as optional, defaulted config because they reinforce security.

### Decisions locked during brainstorming
| Decision | Choice |
|---|---|
| Top-level model | **Worker** (managed compute target). DB-backed, user/org-scoped, CRUD + management page, mirroring `@journeyman/mcp`. |
| First concrete worker | **Docker + per-instance + push** — the per-run sandbox. Other types added one by one. |
| Worker = | a configured, persisted **instance of a worker *type***; types are the pluggable backends (§4). |
| Type vs mode | **Two layered choices.** A worker has a **type** (where) and an **execution mode** (`per-instance` ephemeral vs `shared` persistent). Allowed modes depend on type. Mode is the axis that decides whether isolation holds. |
| Connectivity | **Both supported; push built first.** `push` = Journeyman reaches out (docker socket / SSH / kube/ECS/cloud API). `agent` = an installed agent on the worker polls for jobs (GitLab/GitHub style), works behind NAT — later phase. |
| Where coding work runs | **Inside the worker's execution unit** (Claude SDK + Bash), never on the host. |
| Association | **Explicit worker selection + system default fallback.** A workflow may pick one Worker; none → default. (Tag/pool routing reserved for later.) |
| Docker image | **Prebuilt image ref OR a Dockerfile.** Dockerfiles are **auto-wrapped**: user writes any base; Journeyman appends a self-contained runner bundle. Image/Dockerfile + resources + network + mode live on the worker — this **subsumes the earlier separate image catalog**. |
| Teardown (per-instance) | **Always destroy on terminal state**, + background reaper + manual `list/prune`. |
| Config surface | image/Dockerfile + optional resource limits + optional network egress + optional env/mounts, **all defaulted**. Isolation is opt-in (no worker / default = `local` → today's in-process behavior). |

### In scope (this spec, phased — see §13)
1. **Worker** entity + types + management CRUD/UI + workflow association + run-start resolution.
2. `IExecutionEnvironment` interface + types in `@journeyman/core`; pluggable **type registry**.
3. New package `@journeyman/workers`: `LocalExecutionEnvironment` (passthrough default) + `DockerExecutionEnvironment` (per-instance, push), the type registry, sandbox tracking, reaper.
4. Base **runner bundle/image** (Node + Claude Agent SDK + bundled `@journeyman/coding-cli` + `journeyman-runner`), versioned with releases.
5. **Runner entrypoint** in `coding-cli` — operations runnable in-process *or* via stdin/stdout.
6. Docker image handling: prebuilt ref **or** Dockerfile with auto-wrap + build/cache.
7. Worker harness/orchestrator wiring: provision, `requiresWorkspace` exec routing, per-exec secret injection, teardown.

### Out of scope (future, same interface)
- `agent` connectivity (build + distribute the polling agent).
- Worker types beyond Docker: `machine-linux` / `machine-windows` (push/SSH), `ecs`, `ec2`, `kubernetes`, `cloud`.
- `shared` execution mode hardening (the model is defined in §10; full machine support lands with the machine type).
- `per-step` execution mode (fresh container per step) — model leaves room (§7); not built now.
- Domain-level network allowlisting (v1 is allow-all/none only; §11.1).
- Container/volume lifetime decoupling across human-task pauses (§16 future hardening).
- Windows runner bundle track.
- Tag/label-based pool routing.

## 2. Current Architecture (baseline)

- A single **worker harness** (`cli-worker`) polls Conductor for registered step types; steps execute **in-process**.
- `WorkerHarness.processOnce` (`packages/orchestrator/src/workers/worker-harness.ts`) creates a workspace **per step** via `DirectoryWorkspaceProvider` at `{baseDir}/{userId}/{workflowInstanceId}/{nodeId}/`, runs `handler.run`, then destroys it.
- `StepContext` (`packages/core/src/types/step-handler.types.ts`) carries `workspaceDir`, `env`, `signal`, `log`.
- `ClaudeProvider` operations (`packages/coding-cli/src/providers/claude/operations/*`) call `query()` from `@anthropic-ai/claude-agent-sdk` **in-process**, scoped only by `cwd` + `env`. No isolation.
- A run is **not** a single unit of execution — steps are independent Conductor tasks.
- Flow definition: `WorkflowGraph` with `defaults?` at flow level; per-node `config`/`executorConfig`/`model`/`retry`/`secretBindings` (`packages/core/src/types/flow.types.ts`).
- Registry precedent we mirror: `@journeyman/mcp` (DB-backed, user/org CRUD + visible-list + catalog + resolver).

## 3. The Worker Model

A `Worker` is a DB-backed, user/org-scoped, named record (managed page, CRUD like `@journeyman/mcp`).

```ts
Worker {
  id,
  scope: "user" | "org" | "system",       // system = built-in defaults (e.g. the default Local Docker)
  name,                                    // "Local Docker", "Java builder", "Win build box"
  type: WorkerType,                        // pluggable; see §4
  executionMode: "per-instance" | "shared",
  connectivity: "push" | "agent",          // push built now; agent later
  config: WorkerConfig,                    // type-specific, validated by the type (§4, §8)
  isDefault?: boolean,                      // exactly one default per scope chain
  tags?: string[],                          // reserved for future pool routing
  status, createdBy, createdAt, updatedAt
}
```

- **`type`** says *where* (the backend). **`executionMode`** says *how* (fresh unit per run vs shared host). **`connectivity`** says *who connects* (Journeyman → worker, or worker → Journeyman).
- **`config`** is type-specific and validated by that type's backend (e.g. Docker config in §8). Operator secrets (SSH keys, kubeconfig, cloud creds) are **referenced by id from the existing secret vault**, never stored raw in the worker row.
- Multiple workers of the same type are normal — a "Java worker" and a ".NET worker" are just two Docker workers with different images. This is what **subsumes the earlier image catalog**.

## 4. Worker Types & the Pluggable Registry

Worker **types** are the pluggable backends. A new type is added by name with no change to callers.

```ts
// packages/core/src/types/execution-environment.types.ts
export type WorkerType =
  | "local" | "docker"
  | "machine-linux" | "machine-windows"
  | "ecs" | "ec2" | "kubernetes" | "cloud";   // open set

export interface ExecutionEnvironmentBackend {
  readonly type: WorkerType;
  readonly supportedModes: ("per-instance" | "shared")[];
  readonly supportedConnectivity: ("push" | "agent")[];
  validateConfig(config: unknown): void;                  // type-specific config schema
  create(worker: ResolvedWorker): IExecutionEnvironment;  // bind config → runnable env
}

export interface IExecutionEnvironmentRegistry {
  register(backend: ExecutionEnvironmentBackend): void;
  get(type: WorkerType): ExecutionEnvironmentBackend;     // throws if unknown/unconfigured
  available(): WorkerType[];                              // types this deployment supports
}
```

**Mode/connectivity matrix (initial intent):**

| Type | Modes | Connectivity |
|---|---|---|
| `local` | shared (in-process) | n/a (host) |
| `docker` | **per-instance** (now), shared (later) | **push** (now), agent (later) |
| `machine-linux` / `machine-windows` | shared, per-instance (via container on host) | push (SSH), agent |
| `ecs` / `kubernetes` / `cloud` | per-instance (task/pod per run) | push (API), agent |
| `ec2` | shared, per-instance | push (SSH/API), agent |

The flow editor only offers `registry.available()` types, and only the modes/connectivity each type declares.

## 5. Execution Interface, Runner & Protocol

`IExecutionEnvironment` is the uniform contract every type implements; the worker harness only ever talks to this.

```ts
export interface ExecutionEnvironmentSpec {
  imageRef: string;                            // resolved image (built from Dockerfile or prebuilt)
  env?: Record<string, string>;                // non-secret; default none
  resources?: { cpus?: number; memoryMb?: number; timeoutSec?: number };
  network?: "none" | "full";                   // default "full"; see §11.1
  mounts?: { source: string; target: string; readOnly?: boolean }[];
}

export interface ProvisionedEnv { runId: string; type: WorkerType; handle: string; volume?: string; }

export interface ExecOp {
  op: string;                       // "analyze" | "plan" | "implement" | "custom-prompt" | git ops
  stdin: unknown;                   // JSON request envelope
  env?: Record<string, string>;     // per-exec secrets, injected at exec time only
  signal?: AbortSignal;
  onLog?: (line: string) => void;   // runner stderr → StepContext.log
}

export interface ExecResult { ok: boolean; structured?: unknown; error?: string; }

export interface IExecutionEnvironment {
  provision(runId: string, spec: ExecutionEnvironmentSpec): Promise<ProvisionedEnv>;  // no-op for shared/local
  exec(env: ProvisionedEnv, op: ExecOp): Promise<ExecResult>;
  destroy(env: ProvisionedEnv): Promise<void>;
  list(filter?: { runId?: string; orphanedOnly?: boolean }): Promise<ProvisionedEnv[]>;
}
```

**The runner** (`@journeyman/coding-cli/runner` → `journeyman-runner` bin, bundled into images, versioned with releases):
- Invoked `journeyman-runner <op>`; reads a JSON request on **stdin** `{ prompt, options, schema, cwd, env, mcps }`.
- Runs the *existing* operation logic from `providers/claude/operations/*` (including `query()` and `logSdkMessage`) with `cwd = /workspace`.
- Writes `{ ok, structured } | { ok, error }` to **stdout**; streams SDK logs on **stderr**.

**Host-side dispatch** in `ClaudeProvider`:
```
analyze(opts) → sandboxed?  env.exec(provisionedEnv, {op:"analyze", stdin:request, env:secrets})
                            → parse stdout → return structured
              → local?      run operation in-process exactly as today
```

`LocalExecutionEnvironment.exec` calls the operation function directly (today's behavior, no isolation) — which is why workflows with no worker / the `local` default are completely unchanged. `DockerExecutionEnvironment.exec` = `docker exec -i <container> journeyman-runner <op>` with the request piped to stdin and secrets via `-e`. The `exec(op, stdin)→stdout` primitive is exactly what `kubectl exec` / ECS `execute-command` expose later, and is the protocol a future `agent` speaks over the network.

## 6. How "push" Works at Runtime (Docker, per-instance)

**Key idea:** the harness stays on the server and stays in control, but the AI/code work runs **inside the per-run container** as a *separate process* launched via `docker exec`. The runner code is **baked into the image ahead of time**, so it is *not* the harness's process — analogous to SSHing into a box and running a command there.

```
                        YOUR SERVER
 ┌───────────────────────────────────────────────────────────────┐
 │   api-server ──► Conductor (queues the workflow's steps)        │
 │                      ▲  poll step / report result               │
 │              ┌───────┴───────┐                                  │
 │              │ worker harness│   "push": talk to Docker socket  │
 │              └───────┬───────┘   docker run / exec / rm         │
 │                      ▼                                          │
 │              /var/run/docker.sock                              │
 │        ┌─────────────┴──────────────┐                          │
 │        ▼                            ▼                           │
 │  ┌───────────────┐           ┌───────────────┐  one fresh      │
 │  │ run #A         │          │ run #B         │  container      │
 │  │ journeyman-    │          │ journeyman-    │  PER RUN        │
 │  │   runner       │          │   runner       │                │
 │  │ + Claude SDK   │          │ + Claude SDK   │                │
 │  │ + /workspace   │          │ + /workspace   │                │
 │  └───────────────┘           └───────────────┘                 │
 └───────────────────────────────────────────────────────────────┘
 (Remote machine/cluster: same idea, transport changes to SSH /
  docker-over-TCP / kube / ECS API. agent mode reverses the arrow.)
```

Per custom phase: harness `docker exec`s the runner → runner runs `query()` + Bash **in the container** on `/workspace` → **the container** calls the Anthropic API over its own network (API key passed as exec env) → stdout result + stderr logs piped back → harness reports done. Subsequent phases hit the **same** container so `/workspace` persists. Run terminal → `docker rm -f` container + volume.

## 7. Workflow Association, Resolution & Management UI

- **Flow-level setting:** a **Worker picker**. A workflow stores `workerId?` in `WorkflowGraph.defaults`. None → the system **default worker** (`local`).
- **Per-step override (kept feasible):** a `WorkflowNode` may carry an optional `workerId` that overrides the workflow's worker for that step. Resolution precedence: node `workerId` → flow `defaults.workerId` → system default. ⚠️ **Workspace caveat:** the per-run `/workspace` volume belongs to *one* worker; if a step picks a *different* worker, it does **not** see the clone/edits made on the workflow's main worker. So per-step worker override is intended for **workspace-independent** steps; all workspace-touching steps of a run (clone → analyze → plan → implement → commit-push) should share a single worker. The flow editor warns when a workspace-touching step selects a different worker than its run.
- **Per-step containers (future granularity):** a future `executionMode: "per-step"` will spawn a fresh container per step (instead of one per run). The interface already supports it (`provision` is per `runId` today; a per-step variant keys by `runId+nodeId`). Not built now, but the model leaves room.
- **Resolution at run start:** load worker → `registry.get(worker.type)` → `validateConfig` → build `ExecutionEnvironmentSpec` from `worker.config` (resolving the image per §8 and any secret refs) → `provision` (per-instance) or attach (shared) → steps run via `exec`.
- **Management page** ("Workers"): list/create/edit/delete (user/org scope), choose type, mode, connectivity, a **type-specific config form** (Docker: image ref *or* Dockerfile editor + resources/network/env), **test connection / test build**, and **set-as-default**. Mirrors the `@journeyman/mcp` management UI.
- **API/DB:** Fastify routes `GET/POST/PATCH/DELETE /workers`, `GET /workers/catalog` (system), `POST /workers/:id/test`; one append-only migration adding a `workers` table (+ build/runtime metadata). Read `docs/constitution/DATABASE_ARCHITECTURE.md` before authoring it.

## 8. Docker Worker — Image & Dockerfile Handling

`config` for a `docker` worker:
```ts
{
  connection:                                            // WHERE the Docker daemon is
    | { kind: "local" }                                  // /var/run/docker.sock on the harness host
    | { kind: "remote"; host: string; tlsSecretRef?: string },  // tcp://host:2376 (+ TLS certs from vault)
  image:
    | { kind: "ref"; imageRef: string }                 // prebuilt, e.g. "myorg/jm-runner:java21"
    | { kind: "dockerfile"; content: string },          // user-authored; auto-wrapped + built
  resources?: { cpus?; memoryMb?; timeoutSec? },
  network?: "none" | "full",                             // default "full" (allow-all); see §11.1
  env?: Record<string,string>,                           // non-secret
  mounts?: { source; target; readOnly? }[]
}
```

**`connection` (the multi-server fix).** A `local` connection uses the harness host's own Docker socket — fine for a single-server deployment. A `remote` connection points every harness at the **same remote Docker daemon**, so when Journeyman scales to multiple servers, *any* server can reach *any* run's container (the container lives on the shared remote daemon, not on whichever server polled the step). This removes the "single-host only" constraint when configured. TLS client certs are vault references, never stored raw.

**Auto-wrap (any base allowed):** the user writes only their toolchain. Journeyman builds an effective image = *user's Dockerfile* + appended final layers that inject a **self-contained runner bundle**:
```dockerfile
# ── appended by Journeyman; user never writes this ──
COPY --from=journeyman/runner-bundle:<version> /opt/journeyman /opt/journeyman
ENV PATH=/opt/journeyman/bin:$PATH
```
- The bundle carries its **own Node + SDK + `journeyman-runner`** under `/opt/journeyman`, so the user's base needs no Node.
- Appended **last**, so user layers aren't clobbered; the user's `CMD`/`ENTRYPOINT` is irrelevant (container runs idle; we `docker exec`).
- **glibc/musl + arch:** the bundle ships in flavors; the builder detects the base's libc/arch and copies the matching one. Unsupported base → build fails with a clear message.
- **Skip-injection:** if the Dockerfile already `FROM journeyman/runner-base`, detection skips double-injection.
- **Build & cache:** built on the worker's Docker daemon, tagged/keyed by a hash of (Dockerfile content + runner bundle version); rebuilt when that changes. Build context is the Dockerfile content (no extra local files in v1).

Prebuilt `ref` images must already contain the runner (documented contract); they're expected to `FROM journeyman/runner-base`.

## 9. Execution Boundary — On-Worker vs Host-Side

Boundary: **does the step touch the run's workspace or run untrusted/AI code?**
- **On the worker (via `exec`):** `clone-repos` + local git ops; `analyze`/`plan`/`implement`/`custom-ai`.
- **Host-side (unchanged):** `getTicket`, `createPR`/`createMR` (REST), Slack — remote API calls needing host network/creds; sandboxing them adds no isolation value.
- **Declarative routing:** each step handler sets `requiresWorkspace: true` (like the existing `retryable`/`tabs` flags). `true` + run has a non-local worker → dispatch via `exec`; else in-process.

## 10. Lifecycle by Execution Mode

**per-instance (isolated):**
- **Provision** at run start (orchestrator run-start hook): create fresh unit + named volume `jm-run-<runId>`, labeled `journeyman.runId` / `journeyman.owner`; record `sandbox_instances` row `{ runId, type, handle, volume, imageRef, status, createdAt }`.
- **Per step:** look up the run's `ProvisionedEnv`; route `requiresWorkspace` steps through `exec` against `/workspace` (shared across the run's steps).
- **Teardown:** **always destroy** container + volume on terminal state (success or failure); mark row `destroyed`.
- **Crash safety:** (1) **background reaper** in the harness — list units by `journeyman.runId` label, destroy those whose run is terminal/unknown, reconcile stuck rows past TTL; (2) **manual cleanup** — CLI `journeyman sandbox list|prune [--runId|--all-orphans]` and API `GET /sandboxes`, `DELETE /sandboxes/:runId`, `POST /sandboxes/prune`. Both go through `IExecutionEnvironment.list/destroy` so they work for any type.

**shared (no per-instance isolation — defined now, full support with machine type):**
- No per-run provision; reuse the long-lived host. Allocate a **clean per-run workspace dir** on it; run steps there; clean up that dir at run end. Documented trade-off: shared processes/network/filesystem — for **trusted/single-tenant** use only. Per-instance mode (even on a machine, via a container per run) is the path to isolation.

**local (default, no worker):** in-process, no provision/teardown — today's behavior, the regression baseline.

## 11. Secrets, Env & Network

- `secretBindings` resolve into `StepContext.env` as today. For on-worker steps, resolved secret values are passed as `-e` flags on the `exec` (process env of that one exec only) — **never** baked into the image, the container's persistent env, or the volume.
- Worker/workflow-level non-secret `env` is set once at provision.
- Worker connection secrets (Docker TLS, SSH/kube/cloud) are vault references resolved by the harness, never persisted in the worker row.

### 11.1 Network egress — allow-all or none (v1)
Two simple modes, both set by Journeyman at provision via `docker run`:
- **`full` (default)** — normal bridge networking; the container has internet. Required for cloning/pushing to the Git host, calling the Anthropic API, and package installs.
- **`none`** — `--network none`; fully offline container (for workers that don't need egress).

Domain-level allowlisting (only specific hosts) is **out of scope for v1** — it would need an external egress proxy / firewalled Docker network and can be added later behind the same `network` field. Default is `full` because coding steps need egress.

### 11.2 MCP servers & Skills inside the container (must behave as today)
Because the SDK now runs in the container, the tools it relies on must be present there:
- **Bake common runtimes** (Node, and the stdio MCP server runtimes Journeyman ships) into the runner base image.
- **Mount** the resolved user/org **Skills** assets and any **stdio MCP** assets into the container at exec time (read-only mount), and **pass the same resolved configs** (`mcps: ResolvedMcpInstance[]`, skills config) in the runner's stdin request — exactly what `analyze`/`custom-ai` consume today.
- **Remote/HTTP MCPs** need only egress (§11.1) + their auth (injected per-exec like other secrets).
- Net effect: MCP + Skills work identically to the in-process path; the only change is *where* the servers run (in the container).

## 12. Backward Compatibility

A workflow with **no worker selected** and **default = `local`** resolves to `LocalExecutionEnvironment` → identical in-process behavior to today. Isolation is strictly opt-in by associating a non-local worker. A regression test guards this.

## 13. Build Order (phased)

1. **Worker entity + type registry + `IExecutionEnvironment`** in `core`; `LocalExecutionEnvironment` registered as default; route `requiresWorkspace` steps through `registry.get(...)` (local) with zero behavior change.
2. **Runner entrypoint** extraction in `coding-cli` (in-process path first); base **runner bundle/image**.
3. **Workers management**: `workers` table + migration, CRUD/catalog/test routes, management UI, flow-level worker picker, default-worker resolution.
4. **Docker worker (per-instance, push)**: `DockerExecutionEnvironment`, `sandbox_instances`, provision/exec/teardown, image-ref path.
5. **Dockerfile path**: auto-wrap + build/cache + glibc/musl detection.
6. **Reaper + manual cleanup** CLI/API.
7. *(Later specs)* shared mode + `machine-*` (SSH push); `agent` connectivity; `ecs`/`ec2`/`kubernetes`/`cloud`; Windows bundle; tag/pool routing.

Each step keeps `npm run check` (typecheck + import boundaries) green.

## 14. Testing Strategy

- **`IExecutionEnvironment` contract tests** — shared suite run against `Local` and `Docker` (provision → exec → destroy → list); future types reuse it.
- **Runner entrypoint** — unit tests for the stdin→op→stdout envelope (success / op error / malformed), SDK `query()` mocked.
- **Docker backend (integration, gated)** — real `docker run/exec/rm`, label/volume lifecycle, network-mode + resource flags; tagged to run only where Docker is available.
- **Dockerfile auto-wrap** — golden tests that the effective Dockerfile appends the runner layer; libc/arch selection; skip-injection when `FROM` base; build-cache key changes on content/version change.
- **Workers CRUD + resolution** — route tests + default-fallback + `validateConfig` per type (mirroring `@journeyman/mcp`).
- **Reaper / manual prune** — orphan detection (crashed-harness scenario) + `sandbox_instances` reconciliation.
- **Backward-compat regression** — no-worker / `local` default runs identically to today.

## 15. Logging & Observability Continuity

The workflow-instance logs panel must keep working unchanged. Today: SDK message → `logSdkMessage(msg, ctx.log)` → `ctx.log` → harness emits a `step.log` event tagged with `workflowInstanceId`/`nodeId` → `jm_workflow_instance_events` → SSE → run-viewer panel.

With the SDK running in the container, only the **first hop** moves:
- Inside the container the runner writes each formatted log line to **stderr as a structured NDJSON line** (`{ line, meta }`) — the exact payload `ctx.log` expects.
- The harness **streams the `docker exec` stderr line-by-line** and calls the real `ctx.log(line, meta)` on the host for each line. From the event bus onward, **nothing changes**.
- **Guarantees:** (1) **stream, don't buffer** — lines forwarded as they arrive, so the SSE panel stays live; (2) **channel separation** — stdout carries *only* the result envelope, stderr carries logs; (3) **tagging stays host-side** — `workflowInstanceId`/`nodeId` are added by the harness, so per-node attribution is automatic.
- **New log categories:** image **build logs** (Dockerfile builds) and **provision logs** (pull/start failures) are emitted as **workflow-level events** (`nodeId: null`) so failures like "couldn't build the Java image" surface in the same panel.

## 16. Constraints, Assumptions & Smaller Requirements

**Assumptions (confirmed):**
- **One container per run; no parallel workspace-touching steps.** A run has a single `/workspace` (one working tree); the design does not isolate concurrent workspace writers. If branches ever edit the workspace in parallel, they share that tree (developer-laptop semantics).
- **System default worker is `local`** (in-process, today's behavior). Selecting a Docker worker is explicit.

**Constraints / refinements adopted from the dry-run:**
- **Multi-server reach:** a `local` Docker connection implies a **single harness host**; multi-server deployments must use a **`remote` Docker connection** (shared daemon) so any harness can reach any run's container (§8). (Sticky run→host routing via Conductor domains is an alternative, deferred.)
- **Pause behavior (now):** during a human-task pause the per-run container is **kept alive** (accepted cost for v1). *Future hardening:* decouple container vs. volume lifetime — drop the idle container on pause, keep the named volume, re-attach a fresh container on resume.
- **Egress must allow coding traffic** (§11.1) or clone/push/install/SDK calls fail.
- **MCP + Skills delivered into the container** (§11.2) so behavior matches the in-process path.

**Smaller requirements (from the dry-run):**
- **Cancellation:** `StepContext.signal` aborting must kill the in-flight `docker exec` and trigger teardown — no orphaned work.
- **stdout discipline:** the runner emits **only** the JSON result envelope on stdout; any diagnostic output goes to stderr (else result parsing corrupts).
- **Build latency/caching:** Dockerfile builds happen at first use; cache by content hash (Dockerfile + runner-bundle version) so only the first run pays the cost, and surface build logs (§15).
