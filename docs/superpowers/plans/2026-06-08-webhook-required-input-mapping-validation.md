# Webhook Trigger Required Input Mapping Validation — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Block publishing a workflow when a webhook trigger leaves a required workflow input without a payload mapping, and surface the missing mapping inline in the editor — full parity with how every other required input behaves.

**Architecture:** Two independent layers, matching how regular steps already work. (1) `validateWorkflowInputs()` in `@journeyman/core` emits a `missing-required` `WorkflowSaveWarning` per unmapped required input → flow-editor renders it as a red field via `useNodeWarningsByKey`. (2) `computeValidationReport()` in `@journeyman/api-server` pushes the same condition into the hard-blocking `missing[]` array, which drives `ok` and blocks publish.

**Tech Stack:** TypeScript, React 19, vitest. Source spec: `docs/superpowers/specs/2026-06-08-webhook-required-input-mapping-validation-design.md`.

---

## Background facts (read before starting)

- `WorkflowInputDef` (`packages/core/src/types/flow.types.ts:61`): `{ name: string; type: ...; description?: string; required?: boolean }`. Workflow inputs live on `WorkflowGraph.inputDefs?: WorkflowInputDef[]`.
- A webhook trigger node has `type === "trigger-webhook"` and `config: TriggerWebhookConfig`, where `inputsMapping: Record<string, { fromPath: string; type: ... }>` (`packages/core/src/types/workflow-trigger.types.ts`).
- `validateWorkflowInputs(flow, catalog)` returns `WorkflowSaveWarning[]`. The `missing-required` variant is `{ code: "missing-required"; message: string; nodeId: string; inputKey: string }`.
- `computeValidationReport()` is **exported** from `packages/api-server/src/routes/flows.ts:204` and returns `{ ok, errors, missing, warnings, secretWarnings, diagnostics }`. `ok = errors.length === 0 && missing.length === 0 && !hasErrorDiagnostic`.
- Tests run with vitest from the repo root: `npx vitest run <path-to-test-file>`. Only `@journeyman/core` has an `npm test` script; api-server tests run via the root vitest binary. **`@journeyman/flow-editor` has no test runner and no React testing-library** — its UI is verified with `tsc --noEmit` (`npm run typecheck -w @journeyman/flow-editor`), not unit tests.

---

## Task 1: Core — emit `missing-required` warning for unmapped required inputs

**Files:**
- Create: `packages/core/src/utils/validate-workflow.webhook-trigger.test.ts`
- Modify: `packages/core/src/utils/validate-workflow.ts` (insert a loop after the existing `webhook-wait` loop, which ends at line ~180)

- [ ] **Step 1: Write the failing test**

Create `packages/core/src/utils/validate-workflow.webhook-trigger.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { validateWorkflowInputs, type ValidationCatalog } from "./validate-workflow.ts";
import type { WorkflowGraph } from "../types/flow.types.ts";

const EMPTY_CATALOG: ValidationCatalog = {};

function flow(
  inputDefs: WorkflowGraph["inputDefs"],
  inputsMapping: Record<string, { fromPath: string; type: string }>,
  includeTrigger = true,
): WorkflowGraph {
  const nodes: WorkflowGraph["nodes"] = [
    { id: "start", type: "start", displayName: "Start", config: {}, position: { x: 0, y: 0 } },
    { id: "end", type: "end", displayName: "End", config: {}, position: { x: 200, y: 0 } },
  ] as unknown as WorkflowGraph["nodes"];
  if (includeTrigger) {
    nodes.push({
      id: "wh",
      type: "trigger-webhook",
      displayName: "Webhook",
      config: { webhookId: "w1", inputsMapping },
      position: { x: 100, y: 0 },
    } as unknown as WorkflowGraph["nodes"][number]);
  }
  return { schemaVersion: "v1", nodes, edges: [], inputDefs } as unknown as WorkflowGraph;
}

describe("validateWorkflowInputs — trigger-webhook input mapping", () => {
  it("warns when a required input has no mapping", () => {
    const w = validateWorkflowInputs(
      flow([{ name: "ticketId", type: "string", required: true }], {}),
      EMPTY_CATALOG,
    );
    const hit = w.filter((x) => x.code === "missing-required" && x.nodeId === "wh");
    expect(hit).toHaveLength(1);
    expect(hit[0].inputKey).toBe("ticketId");
  });

  it("warns when fromPath is whitespace-only", () => {
    const w = validateWorkflowInputs(
      flow([{ name: "ticketId", type: "string", required: true }], {
        ticketId: { fromPath: "   ", type: "string" },
      }),
      EMPTY_CATALOG,
    );
    expect(w.filter((x) => x.nodeId === "wh" && x.inputKey === "ticketId")).toHaveLength(1);
  });

  it("does not warn when a required input has a valid fromPath", () => {
    const w = validateWorkflowInputs(
      flow([{ name: "ticketId", type: "string", required: true }], {
        ticketId: { fromPath: "$.issue.key", type: "string" },
      }),
      EMPTY_CATALOG,
    );
    expect(w.filter((x) => x.nodeId === "wh")).toHaveLength(0);
  });

  it("does not warn for optional inputs with no mapping", () => {
    const w = validateWorkflowInputs(
      flow([{ name: "note", type: "string", required: false }], {}),
      EMPTY_CATALOG,
    );
    expect(w.filter((x) => x.nodeId === "wh")).toHaveLength(0);
  });

  it("emits nothing from this loop when there is no trigger-webhook node", () => {
    const w = validateWorkflowInputs(
      flow([{ name: "ticketId", type: "string", required: true }], {}, false),
      EMPTY_CATALOG,
    );
    expect(w.filter((x) => x.nodeId === "wh")).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run packages/core/src/utils/validate-workflow.webhook-trigger.test.ts`
Expected: FAIL — the first two tests fail (`expected length 1, got 0`) because no webhook-trigger mapping check exists yet. The last three already pass.

- [ ] **Step 3: Add the validation loop**

In `packages/core/src/utils/validate-workflow.ts`, find the end of the existing `webhook-wait` loop (the `for (const node of flow.nodes)` block that pushes the `correlationKey` warning, closing brace near line 180). Immediately after it, insert:

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
          inputKey: inp.name,
        });
      }
    }
  }
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run packages/core/src/utils/validate-workflow.webhook-trigger.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Run the full core suite + typecheck (no regressions)**

Run: `npm test -w @journeyman/core && npm run typecheck -w @journeyman/core`
Expected: all tests pass, tsc reports no errors.

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/utils/validate-workflow.ts packages/core/src/utils/validate-workflow.webhook-trigger.test.ts
git commit -m "feat(core): validate webhook trigger required input mappings"
```

---

## Task 2: api-server — block publish on unmapped required inputs

**Files:**
- Create: `packages/api-server/src/routes/flows.webhook-required-mapping.test.ts`
- Modify: `packages/api-server/src/routes/flows.ts` (insert a loop right after "Check 1", which ends at line ~252, before the "Check 2" comment)

- [ ] **Step 1: Write the failing test**

Create `packages/api-server/src/routes/flows.webhook-required-mapping.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { computeValidationReport } from "./flows.ts";
import type { WorkflowGraph } from "@journeyman/core";

function flow(
  inputsMapping: Record<string, { fromPath: string; type: string }>,
  required = true,
): WorkflowGraph {
  return {
    schemaVersion: "v1",
    nodes: [
      {
        id: "wh",
        type: "trigger-webhook",
        displayName: "Webhook",
        config: { webhookId: "w1", inputsMapping },
        position: { x: 0, y: 0 },
      },
    ],
    edges: [],
    inputDefs: [{ name: "ticketId", type: "string", required }],
  } as unknown as WorkflowGraph;
}

describe("computeValidationReport — webhook required input mapping", () => {
  it("pushes to missing[] and sets ok=false when a required input is unmapped", () => {
    const r = computeValidationReport(flow({}));
    expect(r.missing.some((m) => m.includes("ticketId"))).toBe(true);
    expect(r.ok).toBe(false);
  });

  it("ignores whitespace-only fromPath (still missing)", () => {
    const r = computeValidationReport(flow({ ticketId: { fromPath: "  ", type: "string" } }));
    expect(r.missing.some((m) => m.includes("ticketId"))).toBe(true);
  });

  it("does not flag a fully mapped required input", () => {
    const r = computeValidationReport(flow({ ticketId: { fromPath: "$.issue.key", type: "string" } }));
    expect(r.missing.some((m) => m.includes("ticketId"))).toBe(false);
  });

  it("does not flag optional inputs", () => {
    const r = computeValidationReport(flow({}, false));
    expect(r.missing.some((m) => m.includes("ticketId"))).toBe(false);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run packages/api-server/src/routes/flows.webhook-required-mapping.test.ts`
Expected: FAIL — first two tests fail (`expected true, got false`) because nothing populates `missing[]` for trigger-webhook input mappings yet. (Import takes ~3–4s; that is normal.)

- [ ] **Step 3: Add the Check 1b loop**

In `packages/api-server/src/routes/flows.ts`, locate the end of "Check 1" (the loop pushing `'${node.displayName ?? node.id}' ... is missing required input ...` into `missing`, closing at line ~252) and the `// Check 2:` comment that follows. Insert between them:

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

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run packages/api-server/src/routes/flows.webhook-required-mapping.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Typecheck api-server (no regressions)**

Run: `npm run typecheck -w @journeyman/api-server`
Expected: tsc reports no errors.

- [ ] **Step 6: Commit**

```bash
git add packages/api-server/src/routes/flows.ts packages/api-server/src/routes/flows.webhook-required-mapping.test.ts
git commit -m "feat(api-server): block publish when webhook trigger leaves required input unmapped"
```

---

## Task 3: flow-editor — render the warning inline in the panel

No React test runner exists in `@journeyman/flow-editor`; this task is verified with `tsc` and a manual visual check. Both edits mirror the existing `ConfigTab` → `SchemaForm` warning pattern, reusing the `je-props__field--invalid` and `je-props__field-error-msg` CSS classes.

**Files:**
- Modify: `packages/flow-editor/src/properties-panel/PropertiesPanel.tsx` (add import; call `useNodeWarningsByKey` in `TriggerWebhookPanelWrapper` ~line 95–115; pass `warningsByKey` prop)
- Modify: `packages/flow-editor/src/properties-panel/trigger-webhook-panel.tsx` (add prop to interface; render warning per row)

- [ ] **Step 1: Add the prop to `TriggerWebhookPanel`**

In `packages/flow-editor/src/properties-panel/trigger-webhook-panel.tsx`:

Update the type import on line 3–9 to include `WorkflowSaveWarning`:

```ts
import type {
  TriggerInputMapping,
  TriggerInputMappingType,
  TriggerWebhookConfig,
  WorkflowGraph,
  WorkflowNode,
  WorkflowSaveWarning,
} from "@journeyman/core";
```

Add the optional prop to `TriggerWebhookPanelProps` (after `readOnly?: boolean;`):

```ts
  warningsByKey?: Map<string, WorkflowSaveWarning>;
```

Destructure it in the function signature (alongside `readOnly`):

```ts
export function TriggerWebhookPanel({
  node,
  graph,
  webhooks,
  onPatchConfig,
  readOnly,
  warningsByKey,
}: TriggerWebhookPanelProps): JSX.Element {
```

- [ ] **Step 2: Render the warning on each input row**

In the same file, in the `inputs.map((inp) => { ... })` block (starts ~line 105), replace the row body so the "From path" cell shows the error. Change:

```tsx
            {inputs.map((inp) => {
              const m = mapping[inp.name];
              return (
                <tr key={inp.name}>
                  <td>{inp.name}{inp.required ? " *" : ""}</td>
                  <td>
                    <input
                      type="text"
                      list={`trigger-input-paths-${node.id}`}
                      placeholder="$.path.to.value"
                      value={m?.fromPath ?? ""}
                      disabled={readOnly}
                      onChange={(e) => {
                        const next = { ...mapping };
                        next[inp.name] = {
                          fromPath: e.target.value,
                          type: (m?.type ?? (inp.type as TriggerInputMappingType)),
                        };
                        onPatchConfig({ inputsMapping: next });
                      }}
                    />
                  </td>
```

to:

```tsx
            {inputs.map((inp) => {
              const m = mapping[inp.name];
              const warning = warningsByKey?.get(inp.name);
              return (
                <tr key={inp.name}>
                  <td>{inp.name}{inp.required ? " *" : ""}</td>
                  <td>
                    <div className={`je-props__field${warning ? " je-props__field--invalid" : ""}`}>
                      <input
                        type="text"
                        list={`trigger-input-paths-${node.id}`}
                        placeholder="$.path.to.value"
                        value={m?.fromPath ?? ""}
                        disabled={readOnly}
                        onChange={(e) => {
                          const next = { ...mapping };
                          next[inp.name] = {
                            fromPath: e.target.value,
                            type: (m?.type ?? (inp.type as TriggerInputMappingType)),
                          };
                          onPatchConfig({ inputsMapping: next });
                        }}
                      />
                      {warning && <div className="je-props__field-error-msg">{warning.message}</div>}
                    </div>
                  </td>
```

(Leave the `<td>` for the Type `<select>` and the closing `</tr>` exactly as they are.)

- [ ] **Step 3: Wire warnings through the wrapper**

In `packages/flow-editor/src/properties-panel/PropertiesPanel.tsx`, add this import near the other relative imports (e.g. after the `useWebhooksForPicker` import on line 88):

```ts
import { useNodeWarningsByKey } from "../state/validation-context.tsx";
```

Then update `TriggerWebhookPanelWrapper` (lines ~95–116) to fetch and pass the map:

```tsx
function TriggerWebhookPanelWrapper(props: {
  node: WorkflowNode;
  graph: WorkflowGraph;
  onPatchConfig: (patch: Partial<TriggerWebhookConfig>) => void;
  readOnly?: boolean;
}): JSX.Element {
  const { webhooks } = useWebhooksForPicker();
  const warningsByKey = useNodeWarningsByKey(props.node.id);
  return (
    <TriggerWebhookPanel
      node={props.node}
      graph={props.graph}
      webhooks={webhooks.map((w) => ({
        id: w.id,
        name: w.name,
        knownEventTypes: w.knownEventTypes,
        payloadSchema: w.payloadSchema,
      }))}
      onPatchConfig={props.onPatchConfig}
      readOnly={props.readOnly}
      warningsByKey={warningsByKey}
    />
  );
}
```

- [ ] **Step 4: Typecheck the flow-editor package**

Run: `npm run typecheck -w @journeyman/flow-editor`
Expected: tsc reports no errors.

- [ ] **Step 5: Manual visual verification**

Start the web app (`npm run dev:web`), open a workflow with a webhook trigger and at least one required input, and confirm:
- A required input with an empty "From path" shows a red field + the message "Webhook trigger: required input '<name>' has no payload mapping (set a \"From path\")."
- Typing a valid path clears the red field.
- An optional input with an empty path shows no error.
- Publish is blocked while a required input is unmapped (the validation banner lists it).

- [ ] **Step 6: Commit**

```bash
git add packages/flow-editor/src/properties-panel/PropertiesPanel.tsx packages/flow-editor/src/properties-panel/trigger-webhook-panel.tsx
git commit -m "feat(flow-editor): show required input mapping error on webhook trigger panel"
```

---

## Final verification

- [ ] **Whole-repo check**

Run: `npm run check`
Expected: typecheck + import-boundary checks pass across all workspaces.

Run: `npx vitest run packages/core/src/utils/validate-workflow.webhook-trigger.test.ts packages/api-server/src/routes/flows.webhook-required-mapping.test.ts`
Expected: all new tests pass.

---

## Self-review notes (coverage map)

| Spec requirement | Task |
|---|---|
| Live red-field warning in panel | Task 1 (core warning) + Task 3 (render) |
| Publish blocked on unmapped required input | Task 2 (`missing[]`) |
| Whitespace-only `fromPath` treated as empty | Task 1 + Task 2 tests |
| Optional inputs never flagged | Task 1 + Task 2 tests |
| Reuse `missing-required` code, no new type | Task 1 |
| Reuse existing CSS classes | Task 3 |
| Read inputs from `graph.inputDefs` | Tasks 1–3 all use `inputDefs` |
| `validateForPublish` / flows.ts:289 skip unchanged | No task touches them (verified intentional) |
