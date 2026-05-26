# Include Human-Task and Webhook-Wait Nodes in Upstream Sources

**Date:** 2026-05-26
**Status:** Approved (pending implementation plan)

## Problem

When a step is placed downstream of a `human-task` or `webhook-wait` node, the `{x}` value picker for that step's inputs does not show the upstream pause-node's fields as a source. The same blind spot affects the if-else gate condition picker (which uses the same hook).

Root cause: [`useUpstreamSources`](../../../packages/flow-editor/src/properties-panel/use-upstream-sources.ts) filters reachable upstream nodes with `n.type !== "step"` (line ~109), so any node whose `type` is `"human-task"` or `"webhook-wait"` is silently dropped. The engine, however, materialises these nodes' declared outputs and reserved meta keys at runtime under the same `${nodeId.output.x}` ref shape as a step. The editor is the only layer that can't see them.

## Goal

`useUpstreamSources` returns an `UpstreamSource` for every dominating `human-task` and `webhook-wait` node, exposing both the user-declared output fields and the reserved meta keys as picker entries.

## Non-Goals

- No changes to runtime resolution, engine, or workflow schema.
- No changes to the human-task or webhook-wait node-config UI.
- No changes to `Shape`, `UpstreamSource`, or `UpstreamField` types.
- No changes to the `inputs` side — these nodes don't bind data-flow inputs from upstream, so they have no `Inputs` group.

## Design

### Files touched

- **Modify** `packages/flow-editor/src/properties-panel/use-upstream-sources.ts` — extend the upstream-iteration branch.

That's the entire change.

### Source-building rules

For each dominating upstream node with `type === "human-task"` or `type === "webhook-wait"`:

- Build an `UpstreamSource` with `kind: "node"`, `id: n.id`, `label: n.displayName ?? <default>` where `<default>` is `"Human task"` or `"Webhook wait"`.
- The source has up to two groups, both with `scope: "output"`:

#### Group 1: `Outputs` (user-declared fields)

Read from `n.config.outputs` — an array of `{ name, type, label?, description?, required?, default?, ... }` (see [HumanTaskOutputField](../../../packages/core/src/types/human-task.types.ts) and [WebhookWaitOutputField](../../../packages/core/src/types/webhook-wait.types.ts)). Map each entry to an `UpstreamField`:

| `outputs[i].type` | Resulting `Shape` |
|---|---|
| `"string"` | `{ type: "string" }` |
| `"number"` | `{ type: "number" }` |
| `"boolean"` | `{ type: "boolean" }` |
| `"json"`   | `{ type: "object", fields: {} }` |
| `"date"`   | `{ type: "string" }` *(ISO date string at runtime)* |

Field `name` and `description` come straight from the config entry. The group is omitted if `n.config.outputs` is empty or missing.

#### Group 2: `System` (reserved meta keys)

Always present, even if Group 1 is empty.

- **Human-task fields:** `source` (string), `actor` (string), `resolvedAt` (string), `payload` (object).
- **Webhook-wait fields:** `source` (string), `resolvedAt` (string), `webhookEventId` (string), `payload` (object).

All as `Shape` objects matching the table above (so `payload` → `{ type: "object", fields: {} }`, the rest → `{ type: "string" }`). The reserved key lists already exist in core as `HUMAN_TASK_RESERVED_KEYS` and `WEBHOOK_WAIT_RESERVED_KEYS`; the implementation should derive the field list from those constants to avoid duplicate sources of truth, with a small type-map in the hook for the per-key Shape.

### Reachability

The dominator computation in `useUpstreamSources` already considers every node in `graph.nodes` regardless of `type`. Once the filter is relaxed inside the per-id loop, pause nodes flow through unchanged.

### Edge cases

- **No declared outputs.** Group 1 is omitted; Group 2 still renders. The source is still useful for branching on `source === "timeout"`.
- **Config missing entirely** (malformed workflow). Group 1 omitted; Group 2 still renders. No crash.
- **Display-name collisions.** `useUpstreamSources` doesn't currently disambiguate display-name collisions across sources — the existing `ValuePicker` shows the label as-is, and that's fine here too. Out of scope to change now.
- **Pause node downstream of itself via a loop.** Dominator analysis handles this — only nodes that dominate the picker's host node are included.

## Testing

- Unit: extend `useUpstreamSources` coverage (no existing test file — add one) with three fixtures:
  1. Human-task with two declared outputs (`approved: boolean`, `comments: string`) — assert source has two groups, `Outputs` has both fields with correct shapes, `System` has all four reserved keys.
  2. Webhook-wait with one declared output (`pr_number: number`) — assert `Outputs` has it, `System` has the four webhook-wait reserved keys.
  3. Human-task with empty `config.outputs` — assert source has only the `System` group.
- Manual: place a human-task → step in the editor; open the step's input picker; confirm the human-task appears with its fields and `source`/`actor`/`resolvedAt`/`payload`. Repeat for webhook-wait. Confirm the if-else gate condition picker (downstream of either) sees the same fields.

## Rollout

Single PR. No data migration. No feature flag.
