# Worker DB Secret Resolution

**Date:** 2026-05-03
**Status:** Approved

## Problem

The `cli-worker` runs standalone (no network path to the api-server). It currently resolves secrets only from `process.env`, so any flow step with a `pinned` secret binding (`mode: "pinned", scope: "user"|"org"`) throws a terminal `MissingSecretsError` and the run dies immediately.

Two compounding gaps:

1. `startedByUserId` and `startedByOrgId` are stored in the run DB record but are never injected into the Conductor workflow input — so the worker receives `null` for both and has no context to query the correct user/org row even if it had DB access.
2. The worker has no DB pool, so it cannot call `resolveBindings()` even when context is available.

## Chosen Approach: Direct DB Access

The worker is given `DATABASE_URL` and creates its own PG pool at startup. It calls `resolveBindings()` from `@journeyman/secrets` — the same function already used by the api-server — with the `userId`/`orgId` context extracted from the task input.

Rejected alternatives:
- **Pre-bake secrets at submission time** — plaintext secrets would sit in Conductor's task history; stale on secret rotation.
- **Encrypted envelope** — same rotation problem; adds key-distribution complexity with no real benefit over direct DB access.

## Design

### 1. Context Propagation

`ConductorOrchestrator.submit()` currently passes only user-provided flow inputs to `startWorkflow`. It must also inject three system fields so every task's `inputData` carries them:

```
startWorkflow({
  input: {
    ...args.inputs,
    startedByUserId: args.startedByUserId,   // ← new
    startedByOrgId:  args.startedByOrgId,    // ← new
    flowId:          args.flowId,            // ← new (already partially tracked)
  }
})
```

`ConductorJsonConverter.emitPhase()` must map these three system fields into every SIMPLE task's `inputParameters` as fixed Conductor expression references:

```typescript
startedByUserId: "${workflow.input.startedByUserId}",
startedByOrgId:  "${workflow.input.startedByOrgId}",
flowId:          "${workflow.input.flowId}",
```

This is a system injection — not driven by node `inputs` — applied unconditionally to every phase task.

`WorkerHarness.processOnce()` already extracts `startedByUserId` and `flowId` from `phaseInput`. It must also extract `orgId` from `phaseInput.startedByOrgId` and pass it in the `bindingResolver` ctx.

### 2. Binding Resolver — Two Modes

**`WorkerHarnessDeps.bindingResolver` ctx** gains `orgId: string | null` alongside the existing `userId` and `flowId`.

**cli-worker resolver splits into two modes:**

```
DATABASE_URL present?
  yes → create PG pool at startup
        resolve via resolveBindings(pool, { userId, orgId }, slots, bindings)
        supports auto + pinned (user / org / global)
  no  → existing env-only path
        auto bindings only, pinned → MissingSecretsError
```

`resolveBindings()` from `@journeyman/secrets` already handles the full three-tier precedence (user → org → global env) and decryption. No new resolution logic is needed in the worker.

### 3. Error Handling

| Situation | Behaviour |
|---|---|
| `DATABASE_URL` absent, `pinned` binding encountered | `MissingSecretsError` → `FAILED_WITH_TERMINAL_ERROR` (current behaviour, unchanged) |
| `DATABASE_URL` present, `userId`/`orgId` null, `pinned` binding | `MissingSecretsError("pinned binding requires userId/orgId context")` → terminal |
| `DATABASE_URL` set but DB unreachable | Worker fails at startup (pool creation throws) — fast-fail, not silent |
| Secret name not found in DB | `MissingSecretsError` listing the missing slot names → terminal |

### 4. Backward Compatibility

| Deployment | Behaviour |
|---|---|
| Worker with no `DATABASE_URL` | Identical to today — `auto` from env only |
| Worker with `DATABASE_URL` | Full resolution — `auto` + `pinned` via DB |

The api-server's own resolver is untouched. `@journeyman/secrets` is unchanged. The `WorkerHarnessDeps` interface gains `orgId` in the ctx type but it is `string | null` so all existing callers (including tests) compile without changes.

## Files Touched

| File | Change |
|---|---|
| `packages/orchestrator/src/engines/conductor/conductor-orchestrator.ts` | Inject `startedByUserId`, `startedByOrgId`, `flowId` into `startWorkflow` input |
| `packages/orchestrator/src/flow-json/conductor-converter.ts` | Map three system fields into every task's `inputParameters` in `emitPhase` |
| `packages/orchestrator/src/workers/worker-harness.ts` | Extract `orgId` from `phaseInput`; add `orgId` to `bindingResolver` ctx |
| `packages/orchestrator/src/cli-worker.ts` | Create PG pool when `DATABASE_URL` set; swap resolver to DB-backed path |

No schema migrations. No new packages. No api-server changes.
