# New Run Dialog — Show Workflow-Declared Extra Attributes

## Problem

The **New Run** dialog ([RunsListPage.tsx:25](packages/web/src/routes/RunsListPage.tsx:25)) currently renders only a hard-coded **Issue Ref** input regardless of the selected workflow. Workflows that need additional run-time attributes (e.g. a repo slug, a target branch, an arbitrary parameter) have no way to surface them in the dialog, so users cannot supply them when starting a run.

The underlying machinery to declare and consume per-workflow inputs already exists:

- Authors declare inputs on the start node via [FlowSettingsView.tsx:29](packages/flow-editor/src/properties-panel/FlowSettingsView.tsx:29), which writes `start.config.workflowInputs: WorkflowInputDef[]`.
- The orchestrator, validators, and ref-shape checks all read those inputs through the canonical helper [`getStartWorkflowInputs(start.config)`](packages/core/src/utils/start-node.ts:3).
- The `POST /workflows/:id/workflow-instances` endpoint accepts `inputs: z.record(z.unknown())` ([schemas/run.ts](packages/api-server/src/schemas/run.ts:3)) — the API already passes through arbitrary keys.

The New Run dialog is the only consumer reading from a different (and unwritten) location: `versionQ.data?.definition.inputDefs` ([RunsListPage.tsx:45](packages/web/src/routes/RunsListPage.tsx:45)). `WorkflowGraph.inputDefs` is declared in [flow.types.ts:96](packages/core/src/types/flow.types.ts:96) but no code path ever populates it, so the value is always `undefined` and the dialog renders no dynamic fields.

## Goal

Surface the workflow's declared `workflowInputs` in the New Run dialog, using the same source of truth as the rest of the system, so users can supply the extra attributes a given workflow requires.

## Non-goals

- Adding new input types to `WorkflowInputDef` (current set: `string | number | boolean | json`).
- Allowing ad-hoc free-form attributes that are not declared on the start node.
- Changing how the Issue Ref field is rendered or wired — it stays exactly as it is today.
- Removing the dead `WorkflowGraph.inputDefs` field (tracked as a follow-up).

## Design

Change the dialog to derive its dynamic inputs from the start node's `workflowInputs`, using the existing helper:

```ts
import { getStartWorkflowInputs } from "@journeyman/core";

const startNode = versionQ.data?.definition.nodes.find(n => n.type === "start");
const inputDefs: WorkflowInputDef[] = getStartWorkflowInputs(startNode?.config);
```

Everything else — the dynamic field rendering loop at [RunsListPage.tsx:164](packages/web/src/routes/RunsListPage.tsx:164), the typed coercion for `number` / `boolean` / `json` at [RunsListPage.tsx:53-60](packages/web/src/routes/RunsListPage.tsx:53), the `missingRequired` gate at [RunsListPage.tsx:78](packages/web/src/routes/RunsListPage.tsx:78), and the submit payload — stays unchanged.

### Why this approach

Reading from `start.config.workflowInputs` makes the dialog consistent with every other consumer (`use-upstream-sources.ts`, `validate-ref-shape.ts` in both `flow-editor` and `orchestrator`, and `conductor-converter.ts`). There is one source of truth and no migration is required — workflows authored against the existing editor will immediately surface their declared inputs in the dialog the next time it opens.

### Rejected alternative — mirror to `WorkflowGraph.inputDefs`

Populating `definition.inputDefs` at save time from `start.config.workflowInputs` was considered. It introduces two copies of the same data, requires either a save-time hook or a version-converter step, and risks drift if either copy is written directly. There is no benefit over reading from the canonical location.

### Interaction with Issue Ref

The dialog continues to render the hard-coded Issue Ref provider+id pair and to inject `inputs.issueRef` into the submission payload. If a workflow author happens to also declare a `workflowInput` named `issueRef`, the dynamic loop will write after the hard-coded assignment and effectively override it; this matches today's behaviour and is not changed by this fix.

## Acceptance criteria

1. When the selected workflow's start node has `workflowInputs: [...]`, the dialog renders one field per entry with the correct widget (text / number / boolean select / JSON text), label, required marker, and description.
2. The **Run** button is disabled until every required dynamic input has a non-empty value (existing behaviour preserved).
3. Submission payload includes all dynamic input values under their declared names, with type coercion preserved.
4. When the selected workflow's start node has no `workflowInputs`, the dialog renders exactly as it does today (only Workflow + Issue Ref).
5. No changes are needed in `@journeyman/core`, the API server, or the orchestrator — the fix is local to `packages/web/src/routes/RunsListPage.tsx`.

## Out of scope (follow-ups)

- Remove the unused `WorkflowGraph.inputDefs` field from [flow.types.ts:96](packages/core/src/types/flow.types.ts:96).
- Consider hiding the hard-coded Issue Ref field for workflows that don't use it.
