# Async sandbox provisioning for triggered runs

**Date:** 2026-06-01
**Status:** Approved design — ready for implementation planning

## Problem

When a workflow is triggered (webhook or manual "Run" button) and its worker is a
Docker worker, the API request hangs for the entire Docker image build (30s+) before
responding. The build is awaited inline on the HTTP request path.

Confirmed blocking chain:

```
POST /webhooks/in/:tenantToken              packages/api-server/src/routes/webhooks.ts:16
  └ ingestForWebhook()                       packages/api-server/src/services/webhook-ingest.ts:60
    └ fireWebhookTriggers()                  packages/api-server/src/services/webhook-trigger-fire.ts:52
      └ orchestrator.submit()                packages/orchestrator/src/engines/conductor/conductor-orchestrator.ts:49
        └ await sandboxProvisioner()         conductor-orchestrator.ts:97-104  (awaited inline)
          └ resolveDockerSpec()              packages/workers/src/backends/docker/docker-backend.ts:18
            └ buildDockerfileImage()         packages/workers/src/backends/docker/build-image.ts:16
              └ dockerode build (30s+)       packages/workers/src/backends/docker/docker-client.ts:147
```

The manual "Run" path (`POST /workflows/:id/workflow-instances`,
[flows.ts:655](../../../packages/api-server/src/routes/flows.ts)) goes through the same
`submit()`, so it has the same problem.

## Goals

- Trigger requests (webhook + manual) return immediately, well under the build time.
- The run is visible right away in a `provisioning` phase, then transitions to `running`.
- Provisioning/build failures surface as a **failed run** (not silently logged).
- Preserve the existing ordering invariant: the sandbox must exist before Conductor
  dispatches the first workspace-touching step.

## Non-goals

- Image build strategy. Content-hash caching already exists at
  [build-image.ts:18-21](../../../packages/workers/src/backends/docker/build-image.ts):
  the wrapped Dockerfile is hashed, tagged by that hash, and the build is skipped if the
  image already exists. No change needed there.
- Moving image-build capability into the `cli-worker` process. The worker only `exec`s
  into existing sandboxes; provisioning stays in the api-server process.
- Cross-process durability via Conductor (considered as Approach 3 below, rejected as
  too large for this change).

## Chosen approach: detached "provision-then-start" in the api-server

Split `ConductorOrchestrator.submit()` at the request boundary. Keep the existing
`provision → startWorkflow` order **inside a detached background task**, so the ordering
invariant holds for free — no worker changes, no readiness-gate race.

### Data flow

**Request path (fast, synchronous):**
1. `putWorkflowDef` and create the run instance with status `provisioning`; write grants.
2. Return `{ workflowInstanceId, engineWorkflowId: null }` immediately.
   (`flows.ts` already responds `202 Accepted`.)

**Background task (detached, same api-server process):**
3. `sandboxProvisioner()` (builds image only on hash-cache miss) → `startWorkflow` →
   `setEngineWorkflowId` → status `running` → emit start-node `node.resolved`.
4. On any error in step 3: status `failed` + emit a `step.log` event with the error.
   Since `startWorkflow` has not run, there is no Conductor workflow to terminate.

> Open implementation detail: `putWorkflowDef` may sit on the request path (earlier
> validation feedback) or move into the background (lowest request latency). Default to
> the request path unless it proves slow; either is compatible with this design.

### Why the ordering invariant is preserved

Today `submit()` provisions, then calls `startWorkflow`. We keep that exact order; we
only move both steps off the request thread into a detached task and create the instance
first. Conductor still never dispatches a task until `startWorkflow` runs, which still
happens only after provisioning succeeds.

## Components touched

| Area | Change |
|---|---|
| `packages/core/src/types/workflow-instance.types.ts` | Add `"provisioning"` to `WorkflowInstanceStatus`. It is **not** terminal, so `TERMINAL_STATUSES` / `isTerminalStatus` are unchanged. |
| `packages/orchestrator/src/sync/workflow-instance-syncer.ts` | Add `"provisioning"` to the `NON_TERMINAL` list so the syncer treats it as in-flight. |
| `packages/orchestrator/.../conductor-orchestrator.ts` | Refactor `submit()` into a synchronous prelude (create instance as `provisioning`, grants, return) plus a private detached `runStart()` (fire-and-forget with `.catch`). Change the return type's `engineWorkflowId` to `string \| null`. Move the start-node `node.resolved` emit into `runStart()` after `startWorkflow`. |
| `packages/api-server/src/routes/flows.ts` | Return `engineWorkflowId: null` from the manual run route (value is no longer known synchronously). |
| `packages/api-server/src/services/webhook-trigger-fire.ts` | No change — already uses only `workflowInstanceId`. |
| `packages/api-server/src/composition.ts` | Add a provisioning-timeout reaper (mirrors the existing `SandboxReaper`) that marks runs stuck in `provisioning` past `PROVISION_TIMEOUT_MS` as `failed`. |

### Status choice

A dedicated `provisioning` status (vs. reusing the existing `pending`) was chosen for
UI clarity — the user explicitly wants a visible "provisioning" phase. No DB migration is
required: the status column is `TEXT NOT NULL` with no CHECK constraint
([001_initial.sql:33](../../../packages/migrations/src/sql/001_initial.sql)).

### `engineWorkflowId` null window

During provisioning, `engineWorkflowId` is `null`. The engine reconciler
([engine-reconciler.ts:25](../../../packages/api-server/src/services/engine-reconciler.ts)),
human-task resolver
([resolve-human-task.ts:126](../../../packages/api-server/src/services/resolve-human-task.ts)),
and the syncer all guard with `if (!engineWorkflowId) return`, so a provisioning run is
safely skipped until it starts. No changes needed in those consumers.

## Error handling & edge cases

- **Build/provision failure** → run marked `failed`, error surfaced via `step.log`; no
  orphan Conductor workflow.
- **api-server crash mid-provision** → run stuck in `provisioning`; the reaper fails it
  after `PROVISION_TIMEOUT_MS` (default ~10 min). This is the accepted trade-off of
  in-process background work.
- **Concurrent triggers, same Dockerfile** → first build populates the hash-tagged image;
  the rest hit `imageExists` and skip (already handled by build-image.ts).
- **Local worker (no sandbox)** → provisioner is a no-op as today; the background task
  just runs `startWorkflow` and flips to `running` quickly.

## Testing

- **Unit — request returns before provisioning:** mock a slow provisioner; assert
  `submit()` resolves before the provisioner completes and the instance status is
  `provisioning`.
- **Unit — background success:** status goes `provisioning → running`, `engineWorkflowId`
  is set, start-node `node.resolved` is emitted.
- **Unit — background failure:** provisioner throws → status `failed`, `startWorkflow`
  never called, `step.log` error emitted.
- **Unit — reaper:** an overdue `provisioning` run is marked `failed`; a fresh one is left
  alone.
- **Integration:** trigger a webhook with a Dockerfile worker; assert the HTTP response
  returns well under the build time and the run progresses `provisioning → running`.

## Rejected alternatives

- **Approach 2 — start workflow now + concurrent provision + readiness gate in the
  worker.** Overlaps provisioning with Conductor startup, but introduces a race, a polling
  gate in the worker harness, and clumsier failure surfacing (the workflow is already
  running when provisioning fails). More moving parts for marginal latency gain.
- **Approach 3 — provisioning as a first-class Conductor task/node.** Best
  durability/observability/retry, but the largest change: the `cli-worker` process would
  need image-build/provision capability (it currently only `exec`s), and
  `ConductorJsonConverter` would need to prepend a synthetic task. Heavier than this
  problem warrants now; revisit if in-process durability becomes insufficient.
