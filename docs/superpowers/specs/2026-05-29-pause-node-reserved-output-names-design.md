# Design: Catch bad pause-node output names early

**Date:** 2026-05-29
**Status:** Approved (design)
**Scope:** Problem 1 — declaring an output on a `webhook-wait` / `human-task` node with a name that fails validation (reserved, duplicate, or invalid) should be caught early (inline + publish gate) instead of crashing late at conversion.

## Problem

When a user adds an output field to a Webhook Wait / Human Task node, the editor accepts **any** name. Bad names are only caught later, at flow conversion, with a cryptic error and no indication of which field or how to fix it:

```
Webhook-wait 'Webhook Wait' (webhook-wait_pbfs1v) output name 'payload' collides with a reserved meta key
```

The converter's [`validateOutputNames`](../../../packages/orchestrator/src/flow-json/conductor-converter.ts) (around line 380) already rejects three problems on declared outputs:

1. **reserved** — name collides with a reserved meta key (`payload`, `resolvedAt`, `source`, `webhookEventId` for webhook-wait; `payload`, `resolvedAt`, `source`, `actor` for human-task).
2. **duplicate** — the same output name declared twice.
3. **invalid** — name is not `^[A-Za-z_][A-Za-z0-9_]*$` (e.g. has spaces/symbols or starts with a digit).

But these only fire at conversion/publish time deep in the orchestrator. The editor gives no early feedback, and the converter **inlines** the reserved-key arrays instead of importing the core constants (drift risk).

## Goal

Catch all three problems **early and clearly**:

- **Inline** in the editor — a red note under the offending output-name field as the user types.
- **At the publish/run gate** — block publishing with a clear, node-attributed message.
- **De-duplicate** the converter so it shares one reserved-key source of truth.

## Design

One shared checker, three consumers.

### 1. Core: `validatePauseNodeOutputNames(node)`

Add a pure function in `@journeyman/core` (new file `packages/core/src/utils/pause-node-output-names.ts`) that returns the list of problems on a pause node's declared outputs:

```ts
export type PauseOutputNameReason = "reserved" | "duplicate" | "invalid";

export interface PauseOutputNameProblem {
  name: string;
  index: number;            // position in config.outputs (for inline UI targeting)
  reason: PauseOutputNameReason;
  message: string;          // user-facing, tells them what to do
}

export function validatePauseNodeOutputNames(node: WorkflowNode): PauseOutputNameProblem[];
```

Behaviour:
- Returns `[]` for non-pause nodes and for clean output sets.
- Uses the existing `WEBHOOK_WAIT_RESERVED_KEYS` / `HUMAN_TASK_RESERVED_KEYS` constants — the same source the `pauseNodeOutputSchema` helper uses.
- One problem per offending output (a name can only have one reason; check order: invalid → reserved → duplicate, first match wins).
- Messages:
  - reserved → `"'<name>' is reserved — pick another name."`
  - duplicate → `"Duplicate output name '<name>'."`
  - invalid → `"'<name>' is invalid — use letters, numbers, underscore; don't start with a digit."`

This is the **single source of truth** for output-name validity.

### 2. Editor publish gate — `isValidPhase4Graph`

In [`packages/flow-editor/src/state/validation.ts`](../../../packages/flow-editor/src/state/validation.ts), inside the existing per-node loop, call `validatePauseNodeOutputNames(node)` for each node and push an **error** issue per problem (node-attributed). This:

- sets `validity.ok = false` → run/publish is gated (the editor already wires `validity.ok` to the run button and shows `validity.errors` in the topbar);
- attributes the issue to the node so the existing node-badge UI highlights it.

Message format mirrors the others in that file: `` `Output '<name>' on <nodeLabel>: <message>` ``.

### 3. Inline editor warning

Surface the per-field problem next to each output-name input:

- **Webhook Wait:** [`WebhookWaitConfigEditor.tsx`](../../../packages/flow-editor/src/properties-panel/WebhookWaitConfigEditor.tsx) — the Outputs list (the `outputs.map(...)` rows).
- **Human Task:** the outputs section in [`ControlNodeConfigTab.tsx`](../../../packages/flow-editor/src/properties-panel/ControlNodeConfigTab.tsx) (`je-humantask__outputs`).

Both compute `validatePauseNodeOutputNames(node)` once, index the result by `index`, and render a red message under the matching name input. Follow the existing inline-error pattern already used in the panel (e.g. the `je-hint je-hint--error` class / the `--invalid` field styling used elsewhere in the editor).

### 4. Converter de-dup — `validateOutputNames`

In [`conductor-converter.ts`](../../../packages/orchestrator/src/flow-json/conductor-converter.ts), replace the inlined reserved arrays at the two call sites (`emitHumanTask`, `emitWebhookWait`) with the core `HUMAN_TASK_RESERVED_KEYS` / `WEBHOOK_WAIT_RESERVED_KEYS` constants. The converter keeps its own throw-based check as the last backstop; it just stops maintaining a private copy of the list. (Optionally it can call the shared core checker, but importing the constants is the minimum to remove drift.)

## Files touched

| File | Change |
|---|---|
| `packages/core/src/utils/pause-node-output-names.ts` (new) | `validatePauseNodeOutputNames` + types |
| `packages/core/src/index.ts` | Export the new function + types |
| `packages/flow-editor/src/state/validation.ts` | Push publish-gate errors for bad output names |
| `packages/flow-editor/src/properties-panel/WebhookWaitConfigEditor.tsx` | Inline per-field error |
| `packages/flow-editor/src/properties-panel/ControlNodeConfigTab.tsx` | Inline per-field error (human-task outputs) |
| `packages/orchestrator/src/flow-json/conductor-converter.ts` | Use core reserved-key constants |

## Testing

- **Core:** unit-test `validatePauseNodeOutputNames` — reserved (both node types), duplicate, invalid, clean set → `[]`, non-pause node → `[]`. Verify `index` and `reason` are correct.
- **Editor gate:** `isValidPhase4Graph` test — a webhook-wait node with an output named `payload` yields `ok === false` with a node-attributed error; a clean flow stays `ok`.
- **Converter:** existing behaviour preserved — still throws on a reserved name (now sourced from the core constant). A quick assertion that the converter rejects a `payload` output.

## Acceptance

- Typing a reserved/duplicate/invalid output name shows an inline red note immediately.
- Such a flow cannot be published/run from the editor; the topbar shows a clear, node-attributed message.
- The converter still rejects bad names (backstop) and no longer keeps a private copy of the reserved list.
- The editor and converter agree on what counts as a reserved key.
