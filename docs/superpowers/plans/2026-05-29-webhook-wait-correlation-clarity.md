# Webhook Wait — Correlation Editor Clarity Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the webhook-wait step's Correlation section understandable — clearer copy, a working path-suggestion list on the "Event field", and the `@`-mention field picker on the "Value from this run" field.

**Architecture:** All changes are in `packages/flow-editor`. A new pure helper module converts the stored `correlationKey.value` (`WorkflowInputValue`) to/from the `Segment[]` model that `MentionInput` uses, using **braces** (`{{ref}}`) syntax — the syntax the worker's `replaceTemplateRefs` / conductor `resolveInputs` pipeline expects. The `WebhookWaitConfigEditor` consumes upstream sources (already computed by its parent `ControlNodeConfigTab`) to populate the mention dropdown. No `@journeyman/core` types or backend code change.

**Tech Stack:** React (TSX), existing flow-editor helpers (`MentionInput`, `mention-serialize`, `mention-fields`, `use-upstream-sources`), plain `node:assert` + `tsx` logic tests, CSS in `styles.css`.

---

## Background facts (verified against the codebase)

- The Correlation block lives in `packages/flow-editor/src/properties-panel/WebhookWaitConfigEditor.tsx`, currently lines 116–158, inside a `je-tab--config je-humantask` container.
- `cfg.correlationKey` is `{ eventPath: string; value: WorkflowInputValue }` (`@journeyman/core`, `webhook-wait.types.ts`). `WorkflowInputValue` = `{kind:"literal";value} | {kind:"ref";ref} | {kind:"template";template}`.
- **Defect being fixed:** the Event-path `<input>` uses `list={`acceptif-paths-${node.id}`}` (the Accept-if datalist) instead of the webhook payload-paths datalist, which is `datalistId = `webhook-paths-${node.id}`` (declared line 75, rendered line 173 from `suggestedPaths`). A `<datalist>` resolves by `id` regardless of DOM position, so referencing `datalistId` from the earlier input works.
- The worker resolves the correlation template with `replaceTemplateRefs`, whose regex is `/\{\{(.+?)\}\}/g` (braces) and trims the ref — so the Equals field MUST serialize with **braces** syntax, NOT the `${...}` dollar syntax `ConfigTab` uses.
- `MentionInput` props: `{ value: Segment[]; fields: MentionField[]; placeholder?; readOnly?; expected?: Shape; onChange: (segments: Segment[]) => void }`. We omit `expected` (the event value's type is unknown → no dimming).
- `parseTemplate(s, "braces")` / `segmentsToTemplate(segs, "braces")` from `mention-serialize.ts` handle the braces syntax.
- `toMentionFields(sources: UpstreamSource[]) => MentionField[]` from `mention-fields.ts`. `UpstreamSource` type is exported from `use-upstream-sources.ts`.
- `ControlNodeConfigTab` (`ControlNodeConfigTab.tsx`) already computes `const sources = useUpstreamSources(flow, node.id, catalog, customStepDefs);` (line 66) and renders `<WebhookWaitConfigEditor node={node} onChange={onChange} readOnly={readOnly} />` at line 117. We thread `sources` down rather than recompute.
- Logic tests are plain scripts run with `npx tsx <file>`, using `node:assert/strict`, ending in `console.log("<name>: ok")` (see `mention-serialize.test.ts`).

---

## Task 1: Pure helper — `correlation-value.ts`

Convert `correlationKey.value` ↔ `Segment[]` using braces syntax. Pure functions, unit-tested first (TDD).

**Files:**
- Create: `packages/flow-editor/src/properties-panel/correlation-value.ts`
- Test: `packages/flow-editor/src/properties-panel/correlation-value.test.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/flow-editor/src/properties-panel/correlation-value.test.ts`:

```ts
import assert from "node:assert/strict";
import type { WorkflowInputValue } from "@journeyman/core";
import {
  correlationValueToSegments,
  segmentsToCorrelationValue,
} from "./correlation-value.ts";

// undefined → empty
assert.deepEqual(correlationValueToSegments(undefined), []);

// template (braces) → ref segment
assert.deepEqual(
  correlationValueToSegments({ kind: "template", template: "{{workflow.input.ticketId}}" }),
  [{ kind: "ref", ref: "workflow.input.ticketId" }],
);

// template with surrounding text → text + ref segments
assert.deepEqual(
  correlationValueToSegments({ kind: "template", template: "id-{{a.output.x}}" }),
  [
    { kind: "text", text: "id-" },
    { kind: "ref", ref: "a.output.x" },
  ],
);

// literal → single text segment
assert.deepEqual(
  correlationValueToSegments({ kind: "literal", value: "PR-1" }),
  [{ kind: "text", text: "PR-1" }],
);

// ref kind → single ref segment
assert.deepEqual(
  correlationValueToSegments({ kind: "ref", ref: "a.output.x" }),
  [{ kind: "ref", ref: "a.output.x" }],
);

// segments → braces template value
assert.deepEqual(
  segmentsToCorrelationValue([
    { kind: "text", text: "hi " },
    { kind: "ref", ref: "a.output.x" },
  ]),
  { kind: "template", template: "hi {{a.output.x}}" } satisfies WorkflowInputValue,
);

// empty segments → empty template value
assert.deepEqual(
  segmentsToCorrelationValue([]),
  { kind: "template", template: "" } satisfies WorkflowInputValue,
);

console.log("correlation-value: ok");
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx tsx packages/flow-editor/src/properties-panel/correlation-value.test.ts`
Expected: FAIL — module `./correlation-value.ts` does not exist (import/resolution error).

- [ ] **Step 3: Write the minimal implementation**

Create `packages/flow-editor/src/properties-panel/correlation-value.ts`:

```ts
import type { WorkflowInputValue } from "@journeyman/core";
import { parseTemplate, segmentsToTemplate, type Segment } from "./mention-serialize.ts";

// Correlation templates use {{ref}} (braces) syntax — this matches the worker's
// replaceTemplateRefs() and the conductor resolveInputs() pipeline. Do NOT use the
// ${...} (dollar) syntax that ConfigTab config templates use.
const SYNTAX = "braces" as const;

/** Stored correlation value → editable segments for MentionInput. */
export function correlationValueToSegments(value: WorkflowInputValue | undefined): Segment[] {
  if (!value) return [];
  if (value.kind === "template") return parseTemplate(value.template, SYNTAX);
  if (value.kind === "ref") return [{ kind: "ref", ref: value.ref }];
  return parseTemplate(String(value.value ?? ""), SYNTAX); // literal
}

/** MentionInput segments → stored correlation value (always a braces template). */
export function segmentsToCorrelationValue(segs: Segment[]): WorkflowInputValue {
  return { kind: "template", template: segmentsToTemplate(segs, SYNTAX) };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx tsx packages/flow-editor/src/properties-panel/correlation-value.test.ts`
Expected: PASS — prints `correlation-value: ok`.

- [ ] **Step 5: Commit**

```bash
git add packages/flow-editor/src/properties-panel/correlation-value.ts \
        packages/flow-editor/src/properties-panel/correlation-value.test.ts
git commit -m "feat(flow-editor): correlation value <-> mention segments helper"
```

---

## Task 2: CSS for the sub-labels and connector

Small visual scaffolding so the Correlation block reads like a sentence.

**Files:**
- Modify: `packages/flow-editor/src/styles.css` (append near the other `.je-field` rules, after line 1380)

- [ ] **Step 1: Add the CSS rules**

Append after the `.je-code-block { ... }` rule (line ~1380) in `packages/flow-editor/src/styles.css`:

```css
.je-corr-sublabel {
  display: block;
  font-size: 11px;
  font-weight: 600;
  color: #9a9aa8;
  margin: 8px 0 2px;
}
.je-corr-equals {
  display: block;
  font-size: 11px;
  font-weight: 700;
  color: #6c8eff;
  text-align: center;
  margin: 6px 0 2px;
  letter-spacing: 0.05em;
}
```

- [ ] **Step 2: Commit**

```bash
git add packages/flow-editor/src/styles.css
git commit -m "style(flow-editor): correlation sub-label and equals-connector classes"
```

---

## Task 3: Rebuild the Correlation editor + thread `sources` prop

Add a `sources` prop to `WebhookWaitConfigEditor`, pass it from `ControlNodeConfigTab`, and rewrite the Correlation block: clearer copy, sub-labels, fixed Event-path datalist, and `MentionInput` on the value field.

**Files:**
- Modify: `packages/flow-editor/src/properties-panel/WebhookWaitConfigEditor.tsx`
- Modify: `packages/flow-editor/src/properties-panel/ControlNodeConfigTab.tsx:117`

- [ ] **Step 1: Add imports to `WebhookWaitConfigEditor.tsx`**

At the top of `packages/flow-editor/src/properties-panel/WebhookWaitConfigEditor.tsx`, the existing imports are:

```tsx
import { useMemo, useState } from "react";
import type { CorrelationKey, WorkflowInputValue, WorkflowNode } from "@journeyman/core";
import { AcceptIfBuilder } from "./AcceptIfBuilder.tsx";
import { ListensForPicker } from "./ListensForPicker.tsx";
import { pathsFromSchema, useWebhooksForPicker } from "./useWebhooksForPicker.ts";
```

Add these four import lines below them:

```tsx
import { MentionInput } from "./MentionInput.tsx";
import { toMentionFields } from "./mention-fields.ts";
import type { UpstreamSource } from "./use-upstream-sources.ts";
import { correlationValueToSegments, segmentsToCorrelationValue } from "./correlation-value.ts";
```

- [ ] **Step 2: Add the `sources` prop**

Replace the `Props` interface (currently lines 17–21):

```tsx
interface Props {
  node: WorkflowNode;
  onChange: (next: WorkflowNode) => void;
  readOnly?: boolean;
}
```

with:

```tsx
interface Props {
  node: WorkflowNode;
  onChange: (next: WorkflowNode) => void;
  readOnly?: boolean;
  /** Upstream sources for the correlation @-mention picker (from ControlNodeConfigTab). */
  sources: UpstreamSource[];
}
```

- [ ] **Step 3: Destructure `sources` and compute mention fields**

Change the function signature line (currently line 23):

```tsx
export function WebhookWaitConfigEditor({ node, onChange, readOnly }: Props) {
```

to:

```tsx
export function WebhookWaitConfigEditor({ node, onChange, readOnly, sources }: Props) {
```

Then, immediately after the `suggestedPaths` `useMemo` (currently ends line 42), add:

```tsx
  const mentionFields = useMemo(() => toMentionFields(sources), [sources]);
```

- [ ] **Step 4: Replace the Correlation JSX block**

Replace the entire Correlation `je-field` block (currently lines 116–158):

```tsx
      <div className="je-field">
        <label className="je-field__label">Correlation</label>
        <p className="je-hint">
          When an event arrives, which paused workflow does it belong to? Match
          the event path against a value resolved from this instance.
        </p>
        <input
          type="text"
          placeholder="Event path e.g. $.pull_request.number"
          list={`acceptif-paths-${node.id}`}
          value={cfg.correlationKey?.eventPath ?? ""}
          disabled={readOnly}
          onChange={(e) => {
            const eventPath = e.target.value;
            const value: WorkflowInputValue =
              cfg.correlationKey?.value ?? { kind: "template", template: "" };
            update({ correlationKey: { eventPath, value } });
          }}
          style={{ marginBottom: 6 }}
        />
        <input
          type="text"
          placeholder='Equals (template e.g. "{{ inputs.ticketId }}")'
          value={
            cfg.correlationKey?.value?.kind === "template"
              ? cfg.correlationKey.value.template
              : cfg.correlationKey?.value?.kind === "literal"
                ? String(cfg.correlationKey.value.value ?? "")
                : ""
          }
          disabled={readOnly}
          onChange={(e) => {
            const template = e.target.value;
            const eventPath = cfg.correlationKey?.eventPath ?? "";
            update({
              correlationKey: {
                eventPath,
                value: { kind: "template", template },
              },
            });
          }}
        />
      </div>
```

with:

```tsx
      <div className="je-field">
        <label className="je-field__label">Correlation</label>
        <p className="je-hint">
          When an event arrives, Journeyman matches it to a paused run by comparing
          one value from the incoming event to one value from this run. If they're
          equal, the run resumes.
        </p>

        <label className="je-corr-sublabel">Event field</label>
        <p className="je-hint">Path into the incoming webhook payload.</p>
        <input
          type="text"
          placeholder="e.g. $.pull_request.number"
          list={datalistId}
          value={cfg.correlationKey?.eventPath ?? ""}
          disabled={readOnly}
          onChange={(e) => {
            const eventPath = e.target.value;
            const value: WorkflowInputValue =
              cfg.correlationKey?.value ?? { kind: "template", template: "" };
            update({ correlationKey: { eventPath, value } });
          }}
        />
        {!selectedWebhook && (
          <p className="je-hint">Pick a webhook above to get path suggestions.</p>
        )}

        <span className="je-corr-equals">equals</span>

        <label className="je-corr-sublabel">Value from this run</label>
        <p className="je-hint">Type @ to insert a field from run inputs or upstream steps.</p>
        <MentionInput
          value={correlationValueToSegments(cfg.correlationKey?.value)}
          fields={mentionFields}
          placeholder="Value from this run (type @)"
          readOnly={readOnly}
          onChange={(segs) => {
            const eventPath = cfg.correlationKey?.eventPath ?? "";
            update({ correlationKey: { eventPath, value: segmentsToCorrelationValue(segs) } });
          }}
        />
      </div>
```

Note: `datalistId` (= `` `webhook-paths-${node.id}` ``) and `selectedWebhook` are already defined earlier in the component (lines 75 and 35). The payload `<datalist id={datalistId}>` is rendered later in the Outputs section (line 173) — it resolves by id regardless of DOM order, so no change is needed there.

- [ ] **Step 5: Pass `sources` from `ControlNodeConfigTab`**

In `packages/flow-editor/src/properties-panel/ControlNodeConfigTab.tsx`, the webhook branch (line 117) is:

```tsx
    return <WebhookWaitConfigEditor node={node} onChange={onChange} readOnly={readOnly} />;
```

Change it to (the `sources` variable already exists at line 66):

```tsx
    return <WebhookWaitConfigEditor node={node} onChange={onChange} readOnly={readOnly} sources={sources} />;
```

- [ ] **Step 6: Typecheck the package**

Run: `npm run typecheck --workspace @journeyman/flow-editor`
Expected: PASS — no type errors. (If `WorkflowInputValue` is now reported as an unused import in `WebhookWaitConfigEditor.tsx`, it is still used inside the Event-field `onChange` default value, so it should remain imported.)

- [ ] **Step 7: Repo-wide check**

Run: `npm run check`
Expected: PASS — typecheck across workspaces + import-boundary check clean.

- [ ] **Step 8: Commit**

```bash
git add packages/flow-editor/src/properties-panel/WebhookWaitConfigEditor.tsx \
        packages/flow-editor/src/properties-panel/ControlNodeConfigTab.tsx
git commit -m "feat(flow-editor): clearer webhook-wait correlation editor with path + @-mention suggestions"
```

---

## Manual verification (after Task 3)

1. `npm run dev:web`, open a workflow with a webhook-wait node, select it.
2. **Event field:** confirm focusing the input shows payload-path suggestions from the selected webhook's schema (and the "Pick a webhook above…" hint appears when no webhook is chosen).
3. **Value from this run:** confirm typing `@` opens the mention dropdown listing run inputs / upstream step outputs; picking one inserts a chip.
4. Save, reopen the node: confirm both fields retain their values. An older node whose value was a hand-typed `{{ inputs.ticketId }}` still renders (as a raw-ref chip) and round-trips unchanged.

---

## Self-Review notes

- **Spec coverage:** clearer copy (Task 3 step 4), Event-path datalist fix (Task 3 step 4, `list={datalistId}`), Equals→MentionInput with braces syntax (Tasks 1 + 3), no core/backend/type changes (helper is flow-editor-local; `CorrelationKey` untouched), backward compatibility (Task 1 handles `literal`/`ref`/`template`; manual step 4 verifies). All spec sections map to a task.
- **Type consistency:** `correlationValueToSegments` / `segmentsToCorrelationValue` names are identical across Task 1 (definition + test) and Task 3 (usage). `Segment`, `MentionField`, `UpstreamSource`, `WorkflowInputValue` are imported from their real modules verified above.
- **Syntax correctness:** braces (`{{ }}`) is used everywhere for correlation, matching the worker — deliberately different from ConfigTab's dollar syntax.
