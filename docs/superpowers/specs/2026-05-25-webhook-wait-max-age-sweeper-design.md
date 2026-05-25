# Webhook-Wait Max-Age Sweeper — Design

**Date:** 2026-05-25
**Status:** Draft — pending implementation plan

## Problem

A `webhook-wait` node pauses a workflow instance until a matching webhook event arrives. The node config supports an optional per-instance `timeout`, but:

- Workflow authors can omit it, leaving the instance paused forever.
- Authors can set it absurdly large by mistake (e.g. `365d`).
- Resume-pass cost grows with the number of paused waits bound to a webhook. Stale waits inflate that cost silently.

We need an operator-controlled safety net independent of what any individual workflow declares.

## Goals

- Cap the wall-clock age of any paused `webhook-wait` via a single global env var.
- When the cap is hit, the instance proceeds down its **timeout branch** — same code path as the per-node `timeout` already in [packages/core/src/types/webhook-wait.types.ts](packages/core/src/types/webhook-wait.types.ts).
- Survive process restarts (the existing `InMemoryHumanTaskTimeoutService` does not — this sweeper must).
- Be observable: every sweep is logged; every fired timeout is attributable.

## Non-goals

- Per-org or per-workflow overrides (single global ceiling in v1).
- Replacing the per-node `webhook-wait.config.timeout` — that stays as-is for fine-grained author control. The sweeper is a backstop, not a replacement.
- Sweeping `human-task` paused nodes (separate concern; can copy the pattern later if needed).

## Configuration

One new env var, read at API/orchestrator startup:

| Name | Default | Format | Meaning |
|---|---|---|---|
| `JOURNEYMAN_WEBHOOK_WAIT_MAX_AGE` | `30d` | duration string (`30d`, `12h`, `90m`) | Hard ceiling on any paused webhook-wait. Set to empty string or `off` to disable the sweeper entirely. |
| `JOURNEYMAN_WEBHOOK_WAIT_SWEEP_INTERVAL` | `5m` | duration string | How often the sweeper runs. |

Parsed by the existing duration parser used for `webhook-wait.config.timeout.duration`.

Loaded in [packages/api-server/src/config.ts](packages/api-server/src/config.ts) (or equivalent — placed next to other env loads).

## Behavior

### When the sweeper fires

Every `SWEEP_INTERVAL`, the orchestrator runs a single SQL query:

```sql
SELECT instance_id, node_id, paused_at, config
FROM jm_workflow_instance_nodes
WHERE node_type = 'webhook-wait'
  AND status     = 'paused'
  AND paused_at  < now() - $1::interval   -- MAX_AGE
LIMIT 500;
```

For each row, the sweeper invokes the **same code path** that fires a per-node timeout today, i.e. the existing `webhookWaitTimeout` action that:

1. Constructs the `WebhookWaitOutput` with `source: "timeout"`, `resolvedAt: now()`, `webhookEventId: null`, and the node's `timeout.defaults` merged in.
2. Marks the node `completed` with `triggered_by: "max_age_sweep"` (new audit field).
3. Routes the instance along the timeout edge — same as today.

If the node has no `timeout.defaults` set, the output is just `{ source: "timeout", resolvedAt, webhookEventId: null, payload: {} }`. Downstream nodes are responsible for handling missing fields the same way they would for a normal per-node timeout.

Batch size `500` keeps each tick bounded; the next tick picks up any remainder. No long-running transaction.

### When the sweeper is disabled

If `JOURNEYMAN_WEBHOOK_WAIT_MAX_AGE` is empty or `off`, the sweeper is not registered. Logged once at startup: `[webhook-wait-sweeper] disabled by config`.

### Interaction with per-node timeout

Whichever fires first wins. The per-node timeout (timer-based, in-process) typically fires first when the author set a value smaller than `MAX_AGE`. The sweeper only catches nodes whose declared timeout was longer than `MAX_AGE` or absent entirely.

The per-node timeout cancellation logic stays unchanged — the sweeper doesn't try to coordinate with it. If the per-node timer fires while the sweeper is mid-batch, normal optimistic-concurrency on the node row (status must still be `paused`) prevents a double-fire.

### Audit trail

`jm_workflow_instance_nodes` gains a nullable column:

```sql
ALTER TABLE jm_workflow_instance_nodes
  ADD COLUMN IF NOT EXISTS resolved_by TEXT;  -- 'event' | 'timeout' | 'max_age_sweep' | 'cancel'
```

Populated whenever a paused node is resolved. Surfaced on the run-viewer node detail panel as a small footnote so operators can tell "this fired naturally" from "this got swept."

## Implementation

### New files

| File | Purpose |
|---|---|
| `packages/api-server/src/services/webhook-wait-sweeper.ts` | The sweeper class — `start()`, `stop()`, `tick()`. Mirrors `InMemoryHumanTaskTimeoutService` shape but DB-driven and restart-safe. |
| `packages/migrations/src/sql/029_resolved_by.sql` | Add `resolved_by` column. |

### Changed files

| File | Change |
|---|---|
| `packages/api-server/src/config.ts` | Read + parse the two new env vars. |
| `packages/api-server/src/server.ts` (or main entrypoint) | Register sweeper at boot; shut down cleanly on SIGTERM. |
| `packages/orchestrator/src/actions/webhook-wait-resolve.ts` *(or equivalent existing action)* | Accept `triggeredBy: "max_age_sweep"` as a valid reason; write to `resolved_by`. |
| `packages/run-viewer/src/...` | Show `resolved_by` value in node detail panel. |

The sweeper itself is a tiny class:

```ts
export class WebhookWaitSweeper {
  constructor(
    private readonly maxAge: Duration | null,
    private readonly interval: Duration,
    private readonly fire: (instanceId: string, nodeId: string) => Promise<void>,
    private readonly store: IWorkflowInstanceNodeStore,
  ) {}

  start(): void { /* setInterval → tick() */ }
  stop(): void  { /* clearInterval */ }
  async tick(): Promise<void> {
    if (!this.maxAge) return;
    const rows = await this.store.listPausedWebhookWaitsOlderThan(this.maxAge, 500);
    for (const r of rows) {
      await this.fire(r.instanceId, r.nodeId).catch(err =>
        console.error("[webhook-wait-sweeper]", r, err));
    }
  }
}
```

`fire()` delegates to the same handler that the per-node timer calls today. No new resolve logic — only a new way to invoke it.

## Validation rules

None new — config error at startup throws so a misformatted `MAX_AGE` value never silently disables the safety net.

## Risks

- **Sweeper overload after long outage.** If the sweeper was off for a week, the first tick after restart finds thousands of expired rows. Mitigated by `LIMIT 500` per tick — at 5-min intervals that drains ~140k/day, which is comfortable.
- **`resolved_by` migration on a large `jm_workflow_instance_nodes` table.** Adding a nullable TEXT column is metadata-only on Postgres ≥11, so safe.
- **Operator sets `MAX_AGE` too short.** Workflows with legitimately long-running waits start dying. Documented in env-var description; default of `30d` is deliberately generous.

## Testing

- Unit: duration parsing, sweeper `tick()` calls fire-handler once per eligible row, disabled-config path is a no-op.
- Integration: paused webhook-wait older than `MAX_AGE` is resolved via timeout branch with `source: "timeout"` and `resolved_by: "max_age_sweep"`; per-node timeout and sweeper don't double-fire (one wins via row-status guard); disabling the sweeper via `off` actually disables it.

## Open questions

None at design time.
