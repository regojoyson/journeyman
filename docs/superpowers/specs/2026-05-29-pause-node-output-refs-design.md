# Design: Pause-node outputs as valid reference sources

**Date:** 2026-05-29
**Status:** Approved (design)
**Scope:** Problem 2 only. Problem 1 (block declaring an output whose name collides with a reserved meta key) is a separate, deferred item — see "Deferred" at the end.

## Problem

When a downstream step binds one of its inputs to an output of a **Webhook Wait** or **Human Task** node, workflow validation fails with:

```
Node 'Return randomly true or false' (step_0khy3q) input 'payload': Node 'Webhook Wait' (webhook-wait_pbfs1v) is not a step
```

The reference itself is legitimate — the user picked `output.resolvedAt`, which the editor's @-mention picker offered. The failure is in the validation layer, not the workflow.

### Root cause

The reference-shape resolver only models **`step`** nodes as output producers. At
[`packages/orchestrator/src/flow-json/validate-ref-shape.ts:61`](../../../packages/orchestrator/src/flow-json/validate-ref-shape.ts) it bails on any non-step source:

```ts
if (node.type !== "step" || !node.stepType)
  return { ok: false, error: `Node ${labelNode(node, parsed.source)} is not a step` };
```

Pause nodes (`webhook-wait`, `human-task`) **do** produce outputs — the reserved meta keys plus any declared `config.outputs` — but the resolver has no branch for them. So every downstream reference to a pause-node output is rejected.

This is invoked from the converter at
[`conductor-converter.ts:202`](../../../packages/orchestrator/src/flow-json/conductor-converter.ts) via `validateRefShapeAgainst`, which is why it surfaces at publish/ingest time.

### Why the editor and the checker disagree

The editor **already** models pause-node outputs correctly. [`pause-node-source.ts`](../../../packages/flow-editor/src/properties-panel/pause-node-source.ts) builds the picker list from the reserved keys + declared outputs, with shapes (`shapeForReserved`, `shapeForDeclared`). That is why the dropdown could offer `resolvedAt`. The orchestrator's resolver simply never got the same knowledge — the logic lives only in the editor.

## The rule (agreed)

A Webhook Wait / Human Task node produces a **known list of outputs**:

- **Reserved keys** — always present:
  - Webhook Wait: `payload`, `resolvedAt`, `source`, `webhookEventId`
  - Human Task: `payload`, `resolvedAt`, `source`, `actor`
- **Declared outputs** — whatever the user adds in the node's Outputs section (each has a `name` and a `type`).

Validation of a downstream reference against this list:

- Name **in** the list → **valid**; its type is checked against the consuming input.
- Name **not** in the list → **error** (catches typos like `resolvedAtt`).

There is **no** special "trust the raw payload" deep-path logic. What the node exposes is exactly the reserved keys + declared outputs; that is what the picker shows and what the checker validates. (Consequence: a deep path into `payload`, e.g. `payload.issue.number`, is not a declared field and will not resolve. The intended pattern is to declare an output with a `fromPath` for the slice you need. This was an explicit decision to keep the model simple.)

## Design

Three changes, one shared source of truth.

### 1. `@journeyman/core` — `pauseNodeOutputSchema(node)`

Add one function that returns a pause node's outputs as an `OutputSchema` (`Record<string, Shape>`):

- Reserved keys from the existing constants (`WEBHOOK_WAIT_RESERVED_KEYS` / `HUMAN_TASK_RESERVED_KEYS`), with fixed shapes — `payload` → object, the rest → `string`.
- Declared `config.outputs` mapped by their `type` (`json` → object, `date` → `string`, else the primitive).

This lifts the shape logic that currently lives only in the editor's `pause-node-source.ts` (`shapeForReserved` / `shapeForDeclared`) into core, so the editor and the orchestrator share one implementation and cannot drift. Returns `null` for non-pause nodes.

### 2. Fix the resolver — `validate-ref-shape.ts`

At [`validate-ref-shape.ts:61`](../../../packages/orchestrator/src/flow-json/validate-ref-shape.ts), before the `node.type !== "step"` bail-out, handle pause nodes:

- If the source node is `webhook-wait` or `human-task`, resolve the ref against `pauseNodeOutputSchema(node)` instead of erroring.
- Look up the top-level name in that schema; unknown name → a clear "not declared on \<node\>" error. Known name → check the type via the existing `shapeAtPath` / `shapesCompatible` path, exactly as for steps.

This clears the reported error.

### 3. Editor reuse — `pause-node-source.ts`

Refactor the editor's `pauseNodeSource` to build its picker list from the new core `pauseNodeOutputSchema` (instead of its private `shapeForReserved` / `shapeForDeclared`). Same list, one source of truth — picker and checker stay in lockstep.

## Files touched

| File | Change |
|---|---|
| `packages/core/src/...` (pause-node output helper + index export) | Add `pauseNodeOutputSchema(node): OutputSchema \| null` |
| `packages/orchestrator/src/flow-json/validate-ref-shape.ts` | Branch for pause-node sources; remove the unconditional "is not a step" for them |
| `packages/flow-editor/src/properties-panel/pause-node-source.ts` | Reuse core helper |

## Testing

- **Core:** unit-test `pauseNodeOutputSchema` for both node types — reserved keys present with correct shapes; declared outputs mapped by type; non-pause node → `null`.
- **Resolver:** `validate-ref-shape` tests —
  - downstream ref to a reserved key (`output.resolvedAt`, `output.payload`, `output.source`, `output.webhookEventId` / `output.actor`) resolves ✅;
  - ref to a declared output resolves with its declared type ✅;
  - ref to an unknown name errors clearly ❌;
  - regression: the exact failing case (`step → webhook-wait.output.resolvedAt`) now passes through `validateRefShapeAgainst`.
- **Editor:** confirm `pauseNodeSource` still produces the same picker groups after switching to the core helper.

## Acceptance

- A step input bound to a Webhook Wait / Human Task **reserved** output (`payload`, `resolvedAt`, `source`, `webhookEventId`/`actor`) passes validation and publishes.
- A step input bound to a **declared** output passes and is type-checked.
- A reference to a non-existent output name still errors with a clear message.
- The editor picker and the converter agree (same shared list).

## Deferred — Problem 1 (separate task)

Independent from the above: the editor lets a user **declare** an output whose name collides with a reserved meta key (e.g. naming an output `payload`), which fails later at conversion with "output name '…' collides with a reserved meta key" ([conductor-converter.ts:396](../../../packages/orchestrator/src/flow-json/conductor-converter.ts)). The fix there is to surface an inline warning/error in both pause-node editors (and gate publish), plus have `conductor-converter.validateOutputNames` import the core `*_RESERVED_KEYS` constants instead of inlining them. **To be designed separately — remind the user after Problem 2.**
