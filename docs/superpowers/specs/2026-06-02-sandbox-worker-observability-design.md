# Sandbox / Worker Observability — Design Spec

**Date:** 2026-06-02
**Author:** Samuel Rego
**Status:** Draft — pending review

---

## 1. Problem

After moving provisioning to the worker (Option B), the sandbox/worker lifecycle is silent in the run viewer:

- **Provisioning** (`ensureWorkspace`) emits nothing — it has no logger in its deps. The old api-server `sandboxProvisioner` (which emitted "Provisioning sandbox…" / "Sandbox ready") is now a no-op, so those lines vanished. Only the reaper's run-level **"Sandbox destroyed"** survives.
- **Inside the sandbox**, `SandboxCodingProvider` forwards `onLog` (AI ops stream), but **`SandboxGitProvider` does not** (clone is silent) and **`materialize`/`putArchive` (skills delivery) emits nothing**.
- **Worker internals** use `createLogger` (pino → console), which never becomes a `step.log` event, so they're invisible in the run viewer.

The run viewer renders `step.log` events: `events.append({ workflowInstanceId, nodeId?, eventType: "step.log", payload: { line, meta } })`. The harness exposes `ctx.log` (node-attributed); the api-server `logRun` used run-level (no nodeId).

## 2. Goal

Restore visibility for the three silent areas — **provisioning, in-sandbox ops (clone/materialize), worker actions** — as `step.log` events in the run viewer. Concise lifecycle lines always-on; verbose detail gated by the node's existing `agentLogLevel`.

## 3. Design

**Surface:** run-viewer `step.log` events. **Attribution:** provisioning happens *during* a step now, so its lines attach to that step's node (via `ctx.log`); "Sandbox destroyed" stays the reaper's run-level line.

**Verbosity model:** concise lifecycle lines = **always-on**. Verbose detail (raw in-sandbox stderr, per-file skill delivery, resolved worker/spec) = gated by the node's `agentLogLevel` (`none`/`light`/`medium`/`all`). The harness reads `agentLogLevel` generically, so steps without it (clone) default to concise-only but can opt into verbose by setting it on the node.

### 3.1 Provisioning lifecycle (`ensureWorkspace`)
- Add optional `log?: (line: string) => void` to `EnsureWorkspaceDeps` (and a `verbose?: boolean`), wired by the harness to the current step's `ctx.log` (and `agentLogLevel >= medium`).
- Always-on concise lines:
  - `Provisioning docker workspace (image <ref>)…` / `Provisioning local workspace…` (builder path)
  - `Using existing workspace` (connect path)
  - `Waiting for workspace…` (claim-lost / wait-for-active path)
  - `Workspace ready`
  - On failure: `Workspace provisioning failed: <error>` (before the step fails)
- Verbose (only when `verbose`): resolved worker type/spec, image-pull notes.

### 3.2 In-sandbox op output
- **Clone:** add `onLog?` to `CloneReposOptions`; `SandboxGitProvider.cloneRepos` forwards `onLog` on the `"clone"` ExecOp (mirrors `SandboxCodingProvider`). The clone-repos handler passes `ctx.log` as `onLog` (gated: always-on `Cloning <repo>…`/`Cloned <repo>`; raw git stderr streams only when `agentLogLevel >= medium`).
- **materialize:** the skill-placement step logs `Delivering N skill(s) to workspace` (always-on) via `ctx.log`; per-file detail only at `agentLogLevel` `all`.

### 3.3 Worker actions
- Deep internals stay in pino/console. Only the lifecycle lines above become `step.log`. A few extra worker lines (e.g. `Resolved worker: docker`) surface only at `agentLogLevel >= medium`.

### 3.4 Unchanged
- The reaper's run-level **"Sandbox destroyed"** line stays as-is.

## 4. Components / files
- `packages/orchestrator/src/sandbox/ensure-workspace.ts` — `log?`/`verbose?` deps + lifecycle lines.
- `packages/orchestrator/src/workers/worker-harness.ts` — wire `log`/`verbose` into `ensureWorkspace` from `ctx.log` + resolved `agentLogLevel`.
- `packages/core` `CloneReposOptions` — add `onLog?`.
- `packages/orchestrator/src/sandbox/sandbox-git-provider.ts` — forward `onLog`.
- `packages/orchestrator/src/workers/steps/clone-repos-step-handler.ts` — pass `ctx.log`; concise + gated lines.
- `packages/orchestrator/src/workers/skill-placement.ts` (or the custom-ai handler call site) — `Delivering N skill(s)` line.

## 5. Testing
- **Unit (`ensure-workspace`):** with a fake `log`, asserts the lifecycle lines for builder/connect/wait/ready/fail paths; verbose lines appear only when `verbose: true`.
- **Unit (`SandboxGitProvider`):** the `"clone"` ExecOp carries `onLog` when provided.
- **Unit (clone handler):** concise `Cloning…`/`Cloned` always emitted; raw stderr gated.
- **Harness:** a `log` line from provisioning lands as a `step.log` event on the node.

## 6. Compatibility (providers + workers)

The logging is **additive and provider/worker-agnostic** — it cannot break a different provider or worker:
- Lines are emitted *around* the provider (provisioning, clone, materialize), not inside any provider's AI logic, via the generic `ctx.log` / `onLog` hooks every provider already shares. Adding OpenCode (or any provider) changes nothing here.
- Lifecycle lines come from the single `ensureWorkspace` abstraction, which already covers `local` and `docker` uniformly; future workers (ECS/K8s) implementing `IExecutionEnvironment` get the same lines for free and stream in-box output through the same `onLog` seam.
- All new hooks (`ensureWorkspace.log?`, `CloneReposOptions.onLog?`) are **optional**. A provider/worker that doesn't wire them just logs less — never an error. Logging never alters control flow, provisioning, or results.

Worst case for an unsupported combo: slightly less visibility, never a crash or behavior change.

## 7. Out of scope (YAGNI)
- No new UI controls, no new dedicated log-level setting, no structured metrics/spans. Reuse `agentLogLevel` and the existing `step.log` surface.
