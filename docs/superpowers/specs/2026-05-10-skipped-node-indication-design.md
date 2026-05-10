# Skipped-Node Indication on Terminal Runs — Design

**Date:** 2026-05-10
**Status:** Approved

## Problem

In the run detail view, every workflow node starts as `"pending"` in
`computeNodeStatuses`
([packages/run-viewer/src/status/compute-node-status.ts:16](../../../packages/run-viewer/src/status/compute-node-status.ts)).
A node only leaves that state if an event fires for it. Nodes that the
workflow never reached — the untaken branch of an if/else, End nodes on
unreached paths, downstream phases of a failed branch — never receive an
event, so they stay `"pending"` even after the workflow instance is
`completed` or `failed`.

Users see misleading "pending" labels on a run that's clearly done. Compare
to n8n / GitHub Actions, where unreached nodes render in a muted state
("skipped").

## Goals

- When the workflow instance is in a terminal state (`completed`, `failed`),
  any node still in `pending` becomes `skipped` with a distinct visual.
- Existing `cancelled` semantics preserved — in-flight nodes still flip to
  `cancelled` when the instance is cancelled.
- The new `skipped` style is visually distinguishable from both `pending`
  (yet-to-run) and `cancelled` (user-stopped).

## Non-goals

- Per-edge "branch taken vs not taken" highlighting beyond today's behavior.
- Server-side state. Status remains computed client-side from the event
  stream on each load.
- Reverse-flow analysis (e.g., "this end node was unreachable because of an
  upstream failure"). The existence of a `skipped` label is enough.

## Design

Extend the existing terminal-state cleanup in `computeNodeStatuses` (which
already handles `cancelled`) to cover `completed` and `failed`. Introduce a
new `"skipped"` status so it's visually distinct from `cancelled`.

### Changes

**1. `packages/run-viewer/src/types.ts`** — add `"skipped"` to `NodeStatus`:

```ts
export type NodeStatus =
  | "pending"
  | "running"
  | "retry-backoff"
  | "waiting"
  | "completed"
  | "failed"
  | "cancelled"
  | "skipped";
```

**2. `packages/run-viewer/src/status/compute-node-status.ts`** — replace the
existing `cancelled`-only block at lines 68-74 with a unified terminal pass:

```ts
const terminal =
  args.workflowInstanceStatus === "completed" ||
  args.workflowInstanceStatus === "failed" ||
  args.workflowInstanceStatus === "cancelled";

if (terminal) {
  for (const [id, v] of out) {
    if (v.status === "pending" || v.status === "running" || v.status === "retry-backoff") {
      const next: NodeStatus =
        args.workflowInstanceStatus === "cancelled" ? "cancelled" :
        v.status === "pending" ? "skipped" :
        v.status;
      out.set(id, { ...v, status: next });
    }
  }
}
```

Behavior table:

| Instance status | Node was       | New status |
| --------------- | -------------- | ---------- |
| `cancelled`     | pending        | cancelled  |
| `cancelled`     | running/retry  | cancelled  |
| `completed`     | pending        | **skipped**|
| `failed`        | pending        | **skipped**|
| `completed`/`failed` | running/retry | unchanged (shouldn't normally occur, but no fabrication) |

**3. `packages/run-viewer/src/canvas/status-styles.ts`** — add entries for
`skipped`:

```ts
export const STATUS_CLASS: Record<NodeStatus, string> = {
  // ...existing entries...
  "skipped":       "je-runnode--skipped",
};

export const STATUS_LABEL: Record<NodeStatus, string> = {
  // ...existing entries...
  "skipped":       "skipped",
};
```

**4. CSS** — add `je-runnode--skipped` rule alongside the existing run-node
status classes. Visual treatment: dim grey background, low-opacity border,
~50% opacity on the node body. Distinct from `--pending` (which today reads
as "yet to run") and `--cancelled` (red-ish stop indicator). The exact file
will be located during implementation; it lives next to the other
`je-runnode--*` rules in the run-viewer package.

## Edge cases

| Scenario                                    | Behavior                                                  |
| ------------------------------------------- | --------------------------------------------------------- |
| Instance still running / paused             | No change — pending nodes stay pending.                   |
| Instance completed, all nodes ran           | No change — no pending left.                              |
| Instance completed, if/else branch untaken  | Untaken nodes → skipped.                                  |
| Instance failed mid-flow                    | Downstream never-ran nodes → skipped. Failed node itself stays `failed`. |
| Instance cancelled                          | In-flight → cancelled; never-reached → cancelled (unchanged). |
| Edge connector to a skipped node            | Stays inactive/dim — handled by `ReadOnlyCanvas.tsx:48` (only highlights when target progressed). |

## Verification

Manual smoke test:

- Run an if/else workflow that takes one branch. Wait for completion. Verify
  the untaken branch nodes show "skipped" with the muted style; the End on
  the untaken branch also shows "skipped".
- Run a workflow that fails on a phase before reaching the end. Verify
  downstream nodes that never ran show "skipped".
- Cancel a running workflow. Verify the existing `cancelled` styling is
  unchanged.
- Open a still-running workflow. Verify yet-to-run nodes still show
  "pending" (not "skipped") — terminal logic must not fire mid-run.
