# Webhook Trigger — Required Input Mapping Validation

**Date:** 2026-06-08
**Status:** Approved design

## Problem

The webhook trigger panel shows a `*` next to required workflow inputs in the
**Inputs mapping** table ([trigger-webhook-panel.tsx:109](../../../packages/flow-editor/src/properties-panel/trigger-webhook-panel.tsx)),
implying the field must be filled in. Nothing enforces it. A user can leave a
required input's "From path" blank and still save **and publish** the workflow.

At runtime the trigger reads each mapped path from the incoming payload
([webhook-trigger-fire.ts](../../../packages/api-server/src/services/webhook-trigger-fire.ts)).
A missing mapping silently yields `undefined`, so a required input arrives empty
and the instance starts half-configured — a silent failure that is hard to trace.

Every other place in the product treats a required field with no value as a hard
block (steps, `webhook-wait` correlation keys). The webhook **trigger**'s
`inputsMapping` is exempt from both the live editor warnings and the publish gate.

## Goal

Close the gap: **a workflow cannot be published while a required input has no
payload mapping**, and the missing mapping is surfaced inline in the editor — full
parity with how every other required input behaves.

## Business rule

> For a webhook trigger, every **required** workflow input must have an
> `inputsMapping` entry with a non-empty "From path". Optional inputs are never
> required to be mapped.

- **While editing:** a required input with an empty/whitespace `fromPath` shows a
  red invalid field with a message, on its row in the Inputs mapping table.
- **At publish (and the Validate report):** publish is blocked until every
  required input is mapped.
- The warning shows regardless of whether a webhook is selected (a fresh node
  with no webhook will show both the existing "missing webhookId" error and the
  per-input mapping errors — intentional, consistent with always-show step
  behavior).
- The mapping `type` is ignored for this check (it always has a default). Only the
  presence of a non-empty `fromPath` matters.
- The declared-input list and `required` flag are read from `graph.inputDefs` —
  the same source the panel renders.

## Why two layers

Parity requires touching **two** independent code paths, because that is how
regular steps achieve parity today:

| Concern | Mechanism | Location |
|---|---|---|
| Live in-canvas red field | `validateWorkflowInputs()` → `WorkflowSaveWarning[]` → `useNodeWarningsByKey` | `@journeyman/core` + flow-editor |
| Hard publish block | `computeValidationReport()` "Check 1" → `missing[]` (`ok = … && missing.length === 0`) | `@journeyman/api-server` |

Regular required-step inputs are covered in both. Webhook triggers are in neither.
The fix adds a parallel `trigger-webhook` loop to each. Note: "warning" is only the
internal struct name (`WorkflowSaveWarning` / code `missing-required`) — functionally
the missing-required state **blocks publish** via `missing[]`. It is an error, not a
soft advisory.

## Design

### 1. Core — live in-canvas warnings

In `packages/core/src/utils/validate-workflow.ts`, inside `validateWorkflowInputs()`,
add a loop immediately after the existing `webhook-wait` loop (~line 180),
mirroring its shape:

```ts
// Trigger-webhook nodes must map every required workflow input to a payload path.
for (const node of flow.nodes) {
  if (node.type !== "trigger-webhook") continue;
  const cfg = (node.config ?? {}) as { inputsMapping?: Record<string, { fromPath?: string }> };
  const mapping = cfg.inputsMapping ?? {};
  for (const inp of flow.inputDefs ?? []) {
    if (!inp.required) continue;
    const fromPath = mapping[inp.name]?.fromPath;
    if (!fromPath || fromPath.trim() === "") {
      warnings.push({
        code: "missing-required",
        message: `Webhook trigger: required input '${inp.name}' has no payload mapping (set a "From path").`,
        nodeId: node.id,
        inputKey: inp.name,   // keyed by input name → maps 1:1 to panel rows
      });
    }
  }
}
```

Reuses the existing `missing-required` `WorkflowSaveWarning` variant — no new type.
`inputKey: inp.name` is what lets the panel match a warning to a row.

### 2. UI — render the warning in the panel

Mirror `ConfigTab` → `SchemaForm`:

**a)** In `PropertiesPanel.tsx`, `TriggerWebhookPanelWrapper` calls
`const warningsByKey = useNodeWarningsByKey(node.id)` and passes it to
`TriggerWebhookPanel`.

**b)** In `trigger-webhook-panel.tsx`:
- Add `warningsByKey?: Map<string, WorkflowSaveWarning>` to `TriggerWebhookPanelProps`.
- In the input-rows `map`, look up `const warning = warningsByKey?.get(inp.name)`.
- Apply the existing `je-props__field--invalid` styling to the "From path" cell when
  a warning is present, and render
  `<div className="je-props__field-error-msg">{warning.message}</div>` beneath it.

Reuses the existing CSS classes so the look matches step fields exactly. The `*`
stays — now backed by a real check.

### 3. api-server — publish blocking

In `computeValidationReport()` in `packages/api-server/src/routes/flows.ts`, add a
loop alongside "Check 1" (~line 252) that pushes into the hard-blocking `missing[]`:

```ts
// Check 1b: webhook triggers must map every required workflow input.
for (const node of definition.nodes) {
  if (node.type !== "trigger-webhook") continue;
  const mapping = ((node.config ?? {}) as { inputsMapping?: Record<string, { fromPath?: string }> }).inputsMapping ?? {};
  for (const inp of definition.inputDefs ?? []) {
    if (!inp.required) continue;
    const fromPath = mapping[inp.name]?.fromPath;
    if (!fromPath || fromPath.trim() === "") {
      missing.push(`'${node.displayName ?? node.id}' (${node.id}) is missing payload mapping for required input '${inp.name}'`);
    }
  }
}
```

Because `ok = errors.length === 0 && missing.length === 0 && !hasErrorDiagnostic`,
this blocks both the **Validate** report and **publish**. No change to
`validateForPublish` or the `inputWarnings` skip at flows.ts:289 — that line keeps
skipping `missing-required` from the core walker precisely because Check 1/1b already
covers it as hard-blocking. The two layers stay consistent.

## Testing

**Core (`validate-workflow`):**
- Required input, no mapping → one `missing-required` warning keyed to `{nodeId, inputKey: name}`.
- Required input, whitespace-only `fromPath` → still warns.
- Required input, valid `fromPath` → no warning.
- Optional input, no mapping → no warning.
- No `trigger-webhook` node → no warnings from this loop.

**api-server (`computeValidationReport`):**
- Required input without mapping → message in `missing[]`, `ok === false`.
- Fully-mapped trigger → `ok` stays true.

**flow-editor (panel):**
- Required input with empty `fromPath` renders `je-props__field--invalid` + message.
- Mapped required input renders no error styling.

## Out of scope

- JSONPath syntax validation of `fromPath`.
- Checking that `fromPath` actually exists in the selected webhook's payload schema.
- Validating optional inputs with partial mappings (type set, path blank).

(These were considered under "Option D" during brainstorming and explicitly deferred.)
