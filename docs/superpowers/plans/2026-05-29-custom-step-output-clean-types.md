# Custom-Step Output: Clean Stored Types (no JSON-Schema in storage/editor)

**Goal:** Store custom-step outputs as a clean field list (`CustomStepOutputField[]`, types `string|number|boolean|json-object|json-array`) — exactly like inputs — and generate JSON Schema only at the model-call boundary. No `object`/`array`/raw JSON Schema in the editor or persisted data.

**Why:** Inputs already store a clean enum; outputs stored raw JSON Schema (`object`/`array`) with a UI mapping. Unify them. The only place JSON Schema (with `object`/`array`) appears is the transient schema handed to the AI model in the orchestrator handler.

**Decision:** No migration of existing rows (per user). The `output_schema` jsonb column is reused to store the field array; rows that still hold old JSON Schema read back as `[]`.

## Representation

```ts
// core/types/custom-steps.types.ts
export type CustomStepOutputType =
  | "string" | "number" | "boolean" | "json-object" | "json-array";

export interface CustomStepOutputField {
  name: string;
  type: CustomStepOutputType;
  required: boolean;
  description?: string;
}
```

`CustomAiStep`, `CustomAiStepCreateInput`, `CustomStepExportPayloadV1`:
replace `outputSchema?: CustomStepJsonSchema` with `outputFields?: CustomStepOutputField[]`.
Keep `CustomStepJsonSchema` as the *generated* schema type (converter return + `RunCustomPromptOptions.outputSchema`).

## Conversions (single direction, generated only when needed)

`@journeyman/custom-steps`:
- `outputFieldsToJsonSchema(fields)` → `{ type:"object", properties, required }`; `json-object`→`{type:"object"}`, `json-array`→`{type:"array"}`, scalars passthrough. Used by the orchestrator handler at model-call time.
- `customStepToShape` builds `OutputSchema` (binding Shapes) directly from `outputFields`: `json-object`→`{type:"json",container:"object"}`, `json-array`→`{type:"json",container:"array"}`, scalars→scalar. (Drops `jsonSchemaToOutputSchema`/`jsonSchemaNodeToShape`.)

## Tasks

### Task 1 — core types + exports
- Add `CustomStepOutputType` + `CustomStepOutputField`; swap `outputSchema`→`outputFields` in the three interfaces.
- Export the two new types from `core/index.ts`.
- Verify: `npm run typecheck -w @journeyman/core`.

### Task 2 — converter `outputFieldsToJsonSchema` (TDD)
- Create `custom-steps/src/output-schema.ts` + test.
- Cases: scalar fields; json-object→`{type:"object"}`; json-array→`{type:"array"}`; required list; empty→`{type:"object",properties:{}}`.
- Export from `custom-steps/src/index.ts`.

### Task 3 — shape-adapter from outputFields (TDD)
- `customStepToShape`: build `outputSchema` (Shape map) from `step.outputFields` honoring `outputMode` (`structured`→from fields, `text`→`{result:string}`, `none`→null).
- Remove `jsonSchemaToOutputSchema` + `jsonSchemaNodeToShape`.
- Update `shape-adapter.test.ts` structured-output cases to use `outputFields`.

### Task 4 — db.ts
- `rowToStep`: `outputFields: Array.isArray(r.output_schema) ? r.output_schema : []`.
- insert/update: store `JSON.stringify(input.outputFields ?? [])` into `output_schema`; key off `outputFields`.

### Task 5 — schema-diff.ts
- Replace JSON-Schema `collectPaths` output diff with a flat `outputFields` comparison (removed / type-changed), mirroring the input diff.

### Task 6 — export.ts
- Map `outputFields` through import/export (replace `outputSchema`).

### Task 7 — routes
- `user-custom-steps.ts` (and shared `handleCreate`/update used by `org-custom-steps.ts`): pass `body.outputFields`.

### Task 8 — orchestrator handler
- `custom-ai-step-handler.ts`: `outputSchema: step.outputMode === "structured" ? outputFieldsToJsonSchema(step.outputFields ?? []) : undefined`.

### Task 9 — web editor
- `OutputSchemaEditor.tsx`: props become `fields: CustomStepOutputField[]` + `onFieldsChange`; edit fields directly (no JSON-Schema parse/build); dropdown shows `string/number/boolean/json object/json array`.
- `EditCustomStepModal.tsx`: state `outputFields`; wire to editor + payload.
- `detectCustomStepBreaks.ts`: output diff over `outputFields` (mirror schema-diff).

### Task 10 — full verification
- `npm run check` (workspace typecheck + boundaries) — completeness gate for every `.outputSchema` rename site.
- `npm test`; flow-editor tsx tests.
- Regression: a structured custom step with a `json object` output field → picker shows `json object`, binds to a `json object` input; generated JSON Schema sent to model is valid (`{type:"object"}`).
