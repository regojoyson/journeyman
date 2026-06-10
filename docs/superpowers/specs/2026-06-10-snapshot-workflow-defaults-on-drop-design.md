# Snapshot Workflow Defaults onto New Steps at Drop Time

**Date:** 2026-06-10
**Status:** Approved — ready for implementation planning

## Problem

A workflow stores four default settings in `WorkflowGraph.defaults` (`WorkflowDefaults` in
[packages/core/src/types/flow.types.ts](../../../packages/core/src/types/flow.types.ts)):

1. **Provider** — `executorConfig[kind].provider` (the executor, e.g. Claude / OpenCode)
2. **Model** — `defaultModel`
3. **Retry policy** — `retry`
4. **Sandbox** — `sandboxId`

When a user drags a new step onto the canvas, it does **not** pick up the provider the user
chose for the workflow. Instead the drop handler in
[packages/flow-editor/src/canvas/Canvas.tsx](../../../packages/flow-editor/src/canvas/Canvas.tsx)
hard-codes `executorConfig.provider` to `defaultProviderFor(kind)` — the **system** default —
and never reads `flow.defaults`. Model, retry, and sandbox are left unset on the node (they
inherit at runtime). The user must fix the provider by hand on every new step.

## Desired Behaviour

When a new step is dropped onto the canvas, it should **snapshot** all four workflow defaults
onto itself — copy the values and store them as its own. From then on the step is independent:

- Changing a workflow default later does **not** affect existing steps.
- The user updates each step's config manually.

This is a snapshot (copy-at-drop), not inheritance. It applies **only** to newly-dropped steps;
existing steps on the canvas are untouched.

## Design

A freshly-dropped node starts with empty config, so "snapshot" is a plain copy — no
field-by-field merging is required.

### 1. New pure helper

Add a function next to `newStepNode` in
[packages/flow-editor/src/state/flow-graph.ts](../../../packages/flow-editor/src/state/flow-graph.ts):

```
applyDefaultsToNewNode(node, defaults, executorKind, systemProvider) → node
  • executorConfig.provider = defaults?.executorConfig?.[executorKind]?.provider ?? systemProvider
  • model      = defaults?.defaultModel   (only written if set)
  • retry      = defaults?.retry          (only written if set)
  • sandboxId  = defaults?.sandboxId      (only written if set)
```

Rules:
- A field is only written when it has a value, so the node is never clobbered with `undefined`.
- `provider` always resolves to something: the workflow default if present, otherwise the
  system default (`systemProvider`), preserving today's fallback.
- Pure function (no side effects), returns a new node object.

### 2. Wire into the drop handler

In `Canvas.tsx`'s drop handler: after building the base node from the step definition's
`defaultConfig`, pass it through `applyDefaultsToNewNode`, supplying:
- `flow.defaults`
- `def.executor.kind` as `executorKind`
- the existing `defaultProviderFor(def.executor.kind)` value as `systemProvider`

Then add the resulting node to the canvas.

## Consequences

- The "From flow defaults" inherited tag in the properties panel will no longer show for these
  steps, because each step now stores its own concrete provider/model/retry/sandbox. This is the
  intended "update each step manually" behaviour.

## Out of Scope

- No change to runtime default resolution. `applyWorkflowDefaults` in the orchestrator
  ([packages/orchestrator/src/flow-json/apply-flow-defaults.ts](../../../packages/orchestrator/src/flow-json/apply-flow-defaults.ts))
  stays as-is; it will see concrete values on the node and leave them unchanged.
- No migration or change to steps already present on a canvas.
- No cross-package code sharing with the orchestrator's merge logic (semantics differ: drop-time
  snapshot writes values; runtime merge tracks field sources).

## Testing

Unit test for `applyDefaultsToNewNode`:

- All four defaults set → all four copied onto the node.
- No defaults set → `provider` falls back to the system default; `model`, `retry`, `sandboxId`
  remain unset.
- Partial defaults (e.g. only `defaultModel` set) → only the set fields are copied; `provider`
  still resolves.
