# `@`-Mention Chip Input for Step Inputs — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the `{x}`-button + `ValuePicker` popup on `ConfigTab` string/bind step-input fields with an inline `@`-mention contenteditable that renders picked references as removable chips.

**Architecture:** Two pure, fully-tested helper modules (`mention-serialize` for value↔segment conversion, `mention-fields` for flattening upstream sources into a searchable list) sit under a thin contenteditable React component (`MentionInput`). `SchemaForm` gains an optional per-field render override so `ConfigTab` can mount `MentionInput` for string-like widgets; the bind-only section mounts it directly. `ValuePicker` is retained for all other surfaces.

**Tech Stack:** TypeScript, React 18, existing `@journeyman/core` (`Shape`, `resolveShape`, `WorkflowInputValue`), `UpstreamSource` from `use-upstream-sources.ts`, `sanitizeRef` from `sanitize-ref.ts`. Pure-logic tests run via `npx tsx` with `node:assert`.

**Spec:** [docs/superpowers/specs/2026-05-27-mention-chip-input-design.md](../specs/2026-05-27-mention-chip-input-design.md)

---

## File Map

- **Create** `packages/flow-editor/src/properties-panel/mention-serialize.ts` + `.test.ts` — `Segment` type, `parseTemplate`, `segmentsToTemplate`, `soleRefOf`.
- **Create** `packages/flow-editor/src/properties-panel/mention-fields.ts` + `.test.ts` — `MentionField` type, `toMentionFields`.
- **Create** `packages/flow-editor/src/properties-panel/MentionInput.tsx` — contenteditable component (render, `@` dropdown, chip insert/delete, serialize-on-change).
- **Modify** `packages/flow-editor/src/properties-panel/SchemaForm.tsx` — add optional `renderFieldInput` override prop.
- **Modify** `packages/flow-editor/src/properties-panel/ConfigTab.tsx` — mount `MentionInput` for string-like config fields and bind-only fields; drop `pickerFor`/`ValuePicker` usage in this file.
- **Modify** `packages/flow-editor/src/styles.css` — chip, dropdown, contenteditable styles.

Mention-capable widgets are exactly: `"text"`, `"textarea"`, `"code"`. (`number`, `select`, `checkbox`, `secret` keep their current controls.)

---

## Task 1: `mention-serialize` — value ↔ segments (pure)

**Files:**
- Create: `packages/flow-editor/src/properties-panel/mention-serialize.ts`
- Create: `packages/flow-editor/src/properties-panel/mention-serialize.test.ts`

Converts between a stored string template (with `${ref}` placeholders) and an ordered list of text/ref segments, and detects the "single pure ref" case.

- [ ] **Step 1.1: Write the failing test**

Create `packages/flow-editor/src/properties-panel/mention-serialize.test.ts`:

```ts
import assert from "node:assert/strict";
import { parseTemplate, segmentsToTemplate, soleRefOf, type Segment } from "./mention-serialize.ts";

// parseTemplate: plain text
assert.deepEqual(parseTemplate("hello"), [{ kind: "text", text: "hello" }]);

// parseTemplate: single ref only
assert.deepEqual(parseTemplate("${a.output.x}"), [{ kind: "ref", ref: "a.output.x" }]);

// parseTemplate: text + ref + text
assert.deepEqual(parseTemplate("feature/${a.output.x}-done"), [
  { kind: "text", text: "feature/" },
  { kind: "ref", ref: "a.output.x" },
  { kind: "text", text: "-done" },
]);

// parseTemplate: two refs
assert.deepEqual(parseTemplate("${a.output.x}${b.input.y}"), [
  { kind: "ref", ref: "a.output.x" },
  { kind: "ref", ref: "b.input.y" },
]);

// parseTemplate: empty string
assert.deepEqual(parseTemplate(""), []);

// segmentsToTemplate: round-trips
const segs: Segment[] = [
  { kind: "text", text: "feature/" },
  { kind: "ref", ref: "a.output.x" },
];
assert.equal(segmentsToTemplate(segs), "feature/${a.output.x}");
assert.equal(segmentsToTemplate([]), "");

// soleRefOf: exactly one ref, no text → the ref
assert.equal(soleRefOf([{ kind: "ref", ref: "a.output.x" }]), "a.output.x");

// soleRefOf: ref with surrounding whitespace-only text → still sole
assert.equal(soleRefOf([
  { kind: "text", text: "  " },
  { kind: "ref", ref: "a.output.x" },
]), "a.output.x");

// soleRefOf: ref + real text → null
assert.equal(soleRefOf([
  { kind: "text", text: "feature/" },
  { kind: "ref", ref: "a.output.x" },
]), null);

// soleRefOf: two refs → null
assert.equal(soleRefOf([
  { kind: "ref", ref: "a.output.x" },
  { kind: "ref", ref: "b.input.y" },
]), null);

// soleRefOf: no refs → null
assert.equal(soleRefOf([{ kind: "text", text: "hi" }]), null);

console.log("mention-serialize: ok");
```

- [ ] **Step 1.2: Run test to verify it fails**

Run: `npx tsx packages/flow-editor/src/properties-panel/mention-serialize.test.ts`
Expected: FAIL — `Cannot find module './mention-serialize.ts'`.

- [ ] **Step 1.3: Implement**

Create `packages/flow-editor/src/properties-panel/mention-serialize.ts`:

```ts
export type Segment =
  | { kind: "text"; text: string }
  | { kind: "ref"; ref: string };

const REF_RE = /\$\{([^}]*)\}/g;

/** Split a stored template string into ordered text/ref segments. */
export function parseTemplate(s: string): Segment[] {
  if (!s) return [];
  const out: Segment[] = [];
  let last = 0;
  for (const m of s.matchAll(REF_RE)) {
    const idx = m.index ?? 0;
    if (idx > last) out.push({ kind: "text", text: s.slice(last, idx) });
    out.push({ kind: "ref", ref: m[1] });
    last = idx + m[0].length;
  }
  if (last < s.length) out.push({ kind: "text", text: s.slice(last) });
  return out;
}

/** Join segments back into a template string, wrapping refs as ${ref}. */
export function segmentsToTemplate(segs: Segment[]): string {
  return segs
    .map(seg => (seg.kind === "text" ? seg.text : "${" + seg.ref + "}"))
    .join("");
}

/**
 * If the segments represent exactly one ref and no non-whitespace text,
 * return that ref; otherwise null. Used to decide ref-binding vs template.
 */
export function soleRefOf(segs: Segment[]): string | null {
  const refs = segs.filter(s => s.kind === "ref") as Extract<Segment, { kind: "ref" }>[];
  if (refs.length !== 1) return null;
  const hasRealText = segs.some(s => s.kind === "text" && s.text.trim() !== "");
  return hasRealText ? null : refs[0].ref;
}
```

- [ ] **Step 1.4: Run test to verify it passes**

Run: `npx tsx packages/flow-editor/src/properties-panel/mention-serialize.test.ts`
Expected: `mention-serialize: ok`

- [ ] **Step 1.5: Commit**

```bash
git add packages/flow-editor/src/properties-panel/mention-serialize.ts packages/flow-editor/src/properties-panel/mention-serialize.test.ts
git commit -m "feat(flow-editor): add mention-serialize value<->segment helpers"
```

---

## Task 2: `mention-fields` — flatten sources (pure)

**Files:**
- Create: `packages/flow-editor/src/properties-panel/mention-fields.ts`
- Create: `packages/flow-editor/src/properties-panel/mention-fields.test.ts`

Flattens `UpstreamSource[]` into a flat searchable list with one entry per leaf field, computing the `showId` duplicate flag and the canonical `ref`.

- [ ] **Step 2.1: Write the failing test**

Create `packages/flow-editor/src/properties-panel/mention-fields.test.ts`:

```ts
import assert from "node:assert/strict";
import type { UpstreamSource } from "./use-upstream-sources.ts";
import { toMentionFields } from "./mention-fields.ts";

const sources: UpstreamSource[] = [
  {
    kind: "run-input",
    id: "",
    label: "Run inputs",
    groups: [{
      title: "Run inputs",
      scope: "run-input",
      fields: [{ name: "ticketId", scope: "run-input", shape: { type: "string" } }],
    }],
  },
  {
    kind: "node",
    id: "ht_a1b2c3",
    label: "Human Task",
    groups: [{
      title: "Outputs",
      scope: "output",
      fields: [
        { name: "approved", scope: "output", shape: { type: "boolean" } },
        { name: "report", scope: "output", shape: { type: "object", fields: { score: { type: "number" } } } },
        { name: "payload", scope: "output", shape: { type: "object", fields: {} } },
      ],
    }],
  },
  {
    kind: "node",
    id: "ht_f9e2d1",
    label: "Human Task",
    groups: [{
      title: "Outputs",
      scope: "output",
      fields: [{ name: "approved", scope: "output", shape: { type: "boolean" } }],
    }],
  },
];

const fields = toMentionFields(sources);

// run-input ref + path
const ticket = fields.find(f => f.ref === "workflow.input.ticketId");
assert.ok(ticket);
assert.equal(ticket!.fieldPath, "ticketId");
assert.equal(ticket!.type, "string");
assert.equal(ticket!.showId, false);

// output leaf
const approved = fields.find(f => f.ref === "ht_a1b2c3.output.approved");
assert.ok(approved);
assert.equal(approved!.fieldPath, "output.approved");
assert.equal(approved!.sourceLabel, "Human Task");
assert.equal(approved!.showId, true); // duplicate "Human Task" label

// nested object leaf
const score = fields.find(f => f.ref === "ht_a1b2c3.output.report.score");
assert.ok(score);
assert.equal(score!.fieldPath, "output.report.score");
assert.equal(score!.type, "number");

// free-form object emitted as-is (no recursion past it)
const payload = fields.find(f => f.ref === "ht_a1b2c3.output.payload");
assert.ok(payload);
assert.equal(payload!.type, "object");
assert.equal(fields.some(f => f.ref.startsWith("ht_a1b2c3.output.payload.")), false);

// unique-label source is not flagged
assert.equal(ticket!.showId, false);

console.log("mention-fields: ok");
```

- [ ] **Step 2.2: Run test to verify it fails**

Run: `npx tsx packages/flow-editor/src/properties-panel/mention-fields.test.ts`
Expected: FAIL — `Cannot find module './mention-fields.ts'`.

- [ ] **Step 2.3: Implement**

Create `packages/flow-editor/src/properties-panel/mention-fields.ts`:

```ts
import type { Shape } from "@journeyman/core";
import { resolveShape } from "@journeyman/core";
import type { UpstreamSource, UpstreamField } from "./use-upstream-sources.ts";

export interface MentionField {
  ref: string;
  sourceId: string;
  sourceLabel: string;
  showId: boolean;
  fieldPath: string;
  type?: string;
}

function refFor(scope: UpstreamField["scope"], sourceId: string, path: string[]): string {
  const tail = path.join(".");
  if (scope === "run-input") return `workflow.input.${tail}`;
  if (scope === "input") return `${sourceId}.input.${tail}`;
  return `${sourceId}.output.${tail}`;
}

function fieldPathFor(scope: UpstreamField["scope"], path: string[]): string {
  const tail = path.join(".");
  if (scope === "run-input") return tail;
  if (scope === "input") return `input.${tail}`;
  return `output.${tail}`;
}

interface Leaf { path: string[]; type?: string }

function flatten(shape: Shape, prefix: string[]): Leaf[] {
  let resolved: Shape;
  try { resolved = resolveShape(shape); } catch { resolved = shape; }
  if (resolved.type === "object") {
    const entries = Object.entries(resolved.fields);
    if (entries.length === 0) return [{ path: prefix, type: "object" }];
    return entries.flatMap(([k, sub]) => flatten(sub, [...prefix, k]));
  }
  if (resolved.type === "array") return [{ path: prefix, type: "array" }];
  return [{ path: prefix, type: resolved.type }];
}

export function toMentionFields(sources: UpstreamSource[]): MentionField[] {
  const labelCounts = new Map<string, number>();
  for (const s of sources) labelCounts.set(s.label, (labelCounts.get(s.label) ?? 0) + 1);

  const out: MentionField[] = [];
  for (const source of sources) {
    const showId = (labelCounts.get(source.label) ?? 0) > 1 && source.kind === "node";
    for (const group of source.groups) {
      for (const field of group.fields) {
        for (const leaf of flatten(field.shape, [field.name])) {
          out.push({
            ref: refFor(group.scope, source.id, leaf.path),
            sourceId: source.id,
            sourceLabel: source.label,
            showId,
            fieldPath: fieldPathFor(group.scope, leaf.path),
            type: leaf.type,
          });
        }
      }
    }
  }
  return out;
}
```

- [ ] **Step 2.4: Run test to verify it passes**

Run: `npx tsx packages/flow-editor/src/properties-panel/mention-fields.test.ts`
Expected: `mention-fields: ok`

- [ ] **Step 2.5: Commit**

```bash
git add packages/flow-editor/src/properties-panel/mention-fields.ts packages/flow-editor/src/properties-panel/mention-fields.test.ts
git commit -m "feat(flow-editor): add mention-fields flattening helper"
```

---

## Task 3: `MentionInput` component

**Files:**
- Create: `packages/flow-editor/src/properties-panel/MentionInput.tsx`

A contenteditable that takes an initial `Segment[]`, renders text + chips, opens an `@` dropdown over `MentionField[]`, and reports `Segment[]` on every change. Pure string logic lives in Tasks 1–2; this component is DOM glue.

- [ ] **Step 3.1: Create the component**

Create `packages/flow-editor/src/properties-panel/MentionInput.tsx`:

```tsx
import { useEffect, useMemo, useRef, useState } from "react";
import type { Segment } from "./mention-serialize.ts";
import type { MentionField } from "./mention-fields.ts";

interface Props {
  value: Segment[];
  fields: MentionField[];
  placeholder?: string;
  readOnly?: boolean;
  onChange: (segments: Segment[]) => void;
}

const REF_ATTR = "data-ref";

/** Render segments into the contenteditable as text nodes + chip spans. */
function renderInto(el: HTMLElement, value: Segment[], fields: MentionField[]) {
  el.textContent = "";
  for (const seg of value) {
    if (seg.kind === "text") {
      el.appendChild(document.createTextNode(seg.text));
    } else {
      el.appendChild(chipEl(seg.ref, fields));
    }
  }
}

function labelForRef(ref: string, fields: MentionField[]): string {
  const f = fields.find(x => x.ref === ref);
  if (!f) return ref; // stale binding — show raw ref
  const id = f.showId ? ` #${f.sourceId.slice(-6)}` : "";
  return `${f.sourceLabel}${id} · ${f.fieldPath}`;
}

function chipEl(ref: string, fields: MentionField[]): HTMLElement {
  const span = document.createElement("span");
  span.className = "je-mention-chip";
  span.setAttribute(REF_ATTR, ref);
  span.setAttribute("contenteditable", "false");
  span.textContent = labelForRef(ref, fields);
  return span;
}

/** Read the contenteditable DOM back into Segment[]. */
function readSegments(el: HTMLElement): Segment[] {
  const segs: Segment[] = [];
  el.childNodes.forEach(node => {
    if (node.nodeType === Node.TEXT_NODE) {
      const text = node.textContent ?? "";
      if (text) segs.push({ kind: "text", text });
    } else if (node instanceof HTMLElement && node.hasAttribute(REF_ATTR)) {
      segs.push({ kind: "ref", ref: node.getAttribute(REF_ATTR)! });
    } else if (node instanceof HTMLElement) {
      const text = node.textContent ?? "";
      if (text) segs.push({ kind: "text", text });
    }
  });
  return segs;
}

export function MentionInput({ value, fields, placeholder, readOnly, onChange }: Props) {
  const ref = useRef<HTMLDivElement | null>(null);
  const [menu, setMenu] = useState<{ query: string } | null>(null);
  const [active, setActive] = useState(0);

  // Render initial value (and when the bound value changes externally).
  useEffect(() => {
    if (ref.current) renderInto(ref.current, value, fields);
  // value identity changes only on external edits; chips are atomic so
  // re-rendering on local edits is unnecessary and would reset the caret.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fieldsKey(fields), valueKey(value)]);

  const filtered = useMemo(() => {
    if (!menu) return [];
    const q = menu.query.toLowerCase();
    const all = fields;
    if (!q) return all.slice(0, 50);
    return all
      .filter(f => `${f.sourceLabel} ${f.fieldPath}`.toLowerCase().includes(q))
      .slice(0, 50);
  }, [menu, fields]);

  const emit = () => { if (ref.current) onChange(readSegments(ref.current)); };

  const insertChip = (f: MentionField) => {
    const el = ref.current;
    if (!el) return;
    // Remove the typed "@query" preceding the caret, then insert a chip.
    const sel = window.getSelection();
    if (sel && sel.rangeCount > 0 && menu) {
      const range = sel.getRangeAt(0);
      const node = range.startContainer;
      if (node.nodeType === Node.TEXT_NODE) {
        const text = node.textContent ?? "";
        const at = text.lastIndexOf("@", range.startOffset - 1);
        if (at >= 0) {
          node.textContent = text.slice(0, at) + text.slice(range.startOffset);
          const r = document.createRange();
          r.setStart(node, at);
          r.collapse(true);
          const chip = chipEl(f.ref, fields);
          r.insertNode(chip);
          // place caret after chip
          r.setStartAfter(chip);
          r.collapse(true);
          sel.removeAllRanges();
          sel.addRange(r);
        }
      }
    }
    setMenu(null);
    setActive(0);
    emit();
  };

  const onInput = () => {
    const el = ref.current;
    if (!el) return;
    const sel = window.getSelection();
    let q: string | null = null;
    if (sel && sel.rangeCount > 0) {
      const range = sel.getRangeAt(0);
      const node = range.startContainer;
      if (node.nodeType === Node.TEXT_NODE) {
        const text = (node.textContent ?? "").slice(0, range.startOffset);
        const at = text.lastIndexOf("@");
        if (at >= 0 && !/\s/.test(text.slice(at + 1))) q = text.slice(at + 1);
      }
    }
    setMenu(q === null ? null : { query: q });
    setActive(0);
    emit();
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (menu && filtered.length > 0) {
      if (e.key === "ArrowDown") { e.preventDefault(); setActive(a => Math.min(a + 1, filtered.length - 1)); return; }
      if (e.key === "ArrowUp")   { e.preventDefault(); setActive(a => Math.max(a - 1, 0)); return; }
      if (e.key === "Enter")     { e.preventDefault(); insertChip(filtered[active]); return; }
      if (e.key === "Escape")    { e.preventDefault(); setMenu(null); return; }
    }
  };

  return (
    <div className="je-mention">
      <div
        ref={ref}
        className="je-mention__editable"
        contentEditable={!readOnly}
        suppressContentEditableWarning
        data-placeholder={placeholder ?? "Type, or @ to insert a value"}
        onInput={onInput}
        onKeyDown={onKeyDown}
        onBlur={emit}
      />
      {menu && filtered.length > 0 && !readOnly && (
        <div className="je-mention__menu">
          {filtered.map((f, i) => (
            <div
              key={f.ref}
              className={`je-mention__item${i === active ? " je-mention__item--active" : ""}`}
              onMouseDown={(e) => { e.preventDefault(); insertChip(f); }}
            >
              <span className="je-mention__item-src">
                {f.sourceLabel}{f.showId ? ` #${f.sourceId.slice(-6)}` : ""}
              </span>
              <span className="je-mention__item-path">{f.fieldPath}</span>
              {f.type && <span className="je-mention__item-type">{f.type}</span>}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function valueKey(value: Segment[]): string {
  return value.map(s => (s.kind === "text" ? `t:${s.text}` : `r:${s.ref}`)).join("|");
}
function fieldsKey(fields: MentionField[]): string {
  return fields.map(f => f.ref).join(",");
}
```

- [ ] **Step 3.2: Typecheck**

Run: `npm run typecheck -w @journeyman/flow-editor`
Expected: clean exit.

- [ ] **Step 3.3: Commit**

```bash
git add packages/flow-editor/src/properties-panel/MentionInput.tsx
git commit -m "feat(flow-editor): add MentionInput contenteditable chip component"
```

---

## Task 4: `SchemaForm` per-field render override

**Files:**
- Modify: `packages/flow-editor/src/properties-panel/SchemaForm.tsx`

Add an optional `renderFieldInput(key, meta)` prop. When it returns a node, `SchemaForm` renders that node in place of the bind control + pill + default `FieldInput` for that field (the mention input handles binding inline). Default behavior is unchanged when the prop is absent or returns `null`.

- [ ] **Step 4.1: Add the prop to the interface**

In `SchemaForm.tsx`, add to `SchemaFormProps` (after `renderBoundPill`):

```ts
  /**
   * Optional override for a field's value control. When it returns a node,
   * it replaces the bind control + pill + default input for that field.
   * Used to mount the @-mention chip input for string-like fields.
   */
  renderFieldInput?: (key: string, meta: FieldMeta) => ReactNode | null;
```

- [ ] **Step 4.2: Destructure the new prop**

Change the function signature destructuring:

```ts
export function SchemaForm({
  config, fields, schema, onChange, readOnly,
  boundKeys, renderFieldBindControl, renderBoundPill, warningsByKey,
  renderFieldInput,
}: SchemaFormProps) {
```

- [ ] **Step 4.3: Use the override in the field loop**

Replace the non-checkbox return block (the `return ( <div key={key} className={fieldClass}> … </div> )` that contains the label-row + isBound branch) with:

```tsx
        const override = renderFieldInput?.(key, meta) ?? null;
        if (override) {
          return (
            <div key={key} className={fieldClass}>
              <div className="je-props__field-label-row">
                <label>{meta.label}</label>
              </div>
              {override}
              {meta.help && <div className="je-props__field-help">{meta.help}</div>}
              {warning && <div className="je-props__field-error-msg">{warning.message}</div>}
            </div>
          );
        }
        return (
          <div key={key} className={fieldClass}>
            <div className="je-props__field-label-row">
              <label>{meta.label}</label>
              {renderFieldBindControl?.(key)}
            </div>
            {isBound && renderBoundPill ? (
              renderBoundPill(key)
            ) : (
              <FieldInput
                meta={meta}
                value={config[key]}
                disabled={readOnly}
                onChange={v => set(key, v)}
              />
            )}
            {meta.help && <div className="je-props__field-help">{meta.help}</div>}
            {warning && <div className="je-props__field-error-msg">{warning.message}</div>}
          </div>
        );
```

- [ ] **Step 4.4: Typecheck**

Run: `npm run typecheck -w @journeyman/flow-editor`
Expected: clean exit.

- [ ] **Step 4.5: Commit**

```bash
git add packages/flow-editor/src/properties-panel/SchemaForm.tsx
git commit -m "feat(flow-editor): SchemaForm supports per-field input override"
```

---

## Task 5: Wire `MentionInput` into `ConfigTab`

**Files:**
- Modify: `packages/flow-editor/src/properties-panel/ConfigTab.tsx`

Mount `MentionInput` for string-like config fields (via `renderFieldInput`) and for bind-only fields (directly). Compute the mention field list once; build each field's initial `Segment[]` from stored `inputs`/`config`; on change, write back per the serialization table.

- [ ] **Step 5.1: Add imports**

Near the top of `ConfigTab.tsx`, add:

```ts
import { MentionInput } from "./MentionInput.tsx";
import { toMentionFields } from "./mention-fields.ts";
import { parseTemplate, segmentsToTemplate, soleRefOf, type Segment } from "./mention-serialize.ts";
```

- [ ] **Step 5.2: Build the mention field list and helpers**

Inside the `ConfigTab` component body, after `sources` is available and after `inputsMap` is defined, add:

```ts
  const mentionFields = useMemo(() => toMentionFields(sources), [sources]);
  const MENTION_WIDGETS = new Set(["text", "textarea", "code"]);

  /** Build the initial chip-editor segments for a field from stored value. */
  const segmentsForField = (key: string): Segment[] => {
    const bound = inputsMap[key];
    if (bound?.kind === "ref" && bound.ref) return [{ kind: "ref", ref: bound.ref }];
    const cfgVal = (config as Record<string, unknown>)[key];
    if (typeof cfgVal === "string") return parseTemplate(cfgVal);
    return [];
  };

  /** Persist edited segments back to inputs/config per the serialization rules. */
  const commitSegments = (key: string, segs: Segment[]) => {
    const inputs = { ...((node.inputs ?? {}) as Record<string, unknown>) };
    const cfg = { ...config };
    const sole = soleRefOf(segs);
    const template = segmentsToTemplate(segs);
    if (sole) {
      inputs[key] = { kind: "ref", ref: sanitizeRef(sole) };
      delete cfg[key];
    } else if (template !== "") {
      delete inputs[key];
      cfg[key] = template;
    } else {
      delete inputs[key];
      delete cfg[key];
    }
    onChange({ ...node, inputs: inputs as WorkflowNode["inputs"], config: cfg });
  };

  const renderMentionField = (key: string, meta: { widget?: string }) => {
    if (!MENTION_WIDGETS.has(meta.widget ?? "text")) return null;
    return (
      <MentionInput
        value={segmentsForField(key)}
        fields={mentionFields}
        readOnly={readOnly}
        onChange={segs => commitSegments(key, segs)}
      />
    );
  };
```

(`useMemo` is already imported in this file via React; if not, add it to the React import.)

- [ ] **Step 5.3: Pass `renderFieldInput` to `SchemaForm`**

In the `<SchemaForm … />` usage, add the prop:

```tsx
            <SchemaForm
              config={config}
              fields={definition.configFields}
              schema={definition.configSchema}
              onChange={next => onChange({ ...node, config: next })}
              readOnly={readOnly}
              boundKeys={boundKeys}
              renderFieldBindControl={renderFieldBindControl}
              renderBoundPill={renderBoundPill}
              renderFieldInput={renderMentionField}
              warningsByKey={nodeWarningsByKey}
            />
```

- [ ] **Step 5.4: Replace the bind-only field body with `MentionInput`**

In the `bindOnlyFields.map(...)` block, replace the `{isBound ? renderBoundPill(key) : (<div className="je-props__bind-only-empty">…</div>)}` and the `{renderFieldBindControl(key)}` in the label row with the mention input. The new body of the `.map` becomes:

```tsx
              {bindOnlyFields.map(([key, meta]) => {
                const isRequired = !!meta.required;
                const warning = nodeWarningsByKey.get(key);
                return (
                  <div key={key} className={`je-props__field${warning ? " je-props__field--invalid" : ""}`}>
                    <div className="je-props__field-label-row">
                      <label>
                        {meta.label ?? key}
                        {isRequired && <span className="je-props__required-mark">*</span>}
                      </label>
                    </div>
                    <MentionInput
                      value={segmentsForField(key)}
                      fields={mentionFields}
                      readOnly={readOnly}
                      placeholder={isRequired ? "Required — @ to bind from upstream" : "Optional — @ to bind"}
                      onChange={segs => commitSegments(key, segs)}
                    />
                    {warning && <div className="je-props__field-error-msg">{warning.message}</div>}
                  </div>
                );
              })}
```

- [ ] **Step 5.5: Remove the now-unused `pickerFor` / `ValuePicker` popover in this file**

Delete the `{pickerFor && (<div className="je-props__picker-popover"><ValuePicker … /></div>)}` block (lines ~285–295). Then remove the now-unused pieces in `ConfigTab.tsx`:
- the `ValuePicker` import,
- the `pickerFor` / `setPickerFor` state,
- `handlePick`, `handleInsert`, and `renderFieldBindControl` if no longer referenced anywhere else in the file.

Run this to confirm what's still referenced before deleting:
```bash
grep -n "pickerFor\|handlePick\|handleInsert\|renderFieldBindControl\|ValuePicker" packages/flow-editor/src/properties-panel/ConfigTab.tsx
```
Remove only the symbols with no remaining references. (`renderBoundPill` / `handleUnbind` may still be referenced by `SchemaForm` for non-mention bound fields — keep those.)

- [ ] **Step 5.6: Typecheck + boundary check**

Run: `npm run typecheck -w @journeyman/flow-editor`
Expected: clean exit. Fix any "declared but never read" errors by removing the dead symbol flagged.

Run: `npm run check:boundaries`
Expected: `✓ Layer boundaries clean across all packages.`

- [ ] **Step 5.7: Commit**

```bash
git add packages/flow-editor/src/properties-panel/ConfigTab.tsx
git commit -m "feat(flow-editor): ConfigTab uses @-mention chip input for string/bind fields"
```

---

## Task 6: Styles

**Files:**
- Modify: `packages/flow-editor/src/styles.css`

- [ ] **Step 6.1: Append chip + dropdown + editable styles**

Append to `packages/flow-editor/src/styles.css`:

```css
/* @-mention chip input (ConfigTab step inputs). */
.je-mention { position: relative; }
.je-mention__editable {
  min-height: 30px;
  background: #1a1a2a;
  border: 1px solid #2a2a3a;
  border-radius: 4px;
  color: #fff;
  padding: 6px 8px;
  font-size: 11px;
  font-family: ui-monospace, monospace;
  line-height: 1.9;
  white-space: pre-wrap;
  word-break: break-word;
}
.je-mention__editable:focus { outline: none; border-color: #6c8eff; }
.je-mention__editable:empty::before {
  content: attr(data-placeholder);
  color: #6a6a7e;
}
.je-mention-chip {
  display: inline-flex;
  align-items: center;
  background: #3a2f6e;
  color: #fff;
  border-radius: 4px;
  padding: 1px 7px;
  margin: 0 1px;
  font-size: 10px;
  white-space: nowrap;
  user-select: none;
}
.je-mention__menu {
  position: absolute;
  left: 0;
  right: 0;
  top: 100%;
  margin-top: 2px;
  z-index: 30;
  max-height: 220px;
  overflow-y: auto;
  background: #11111c;
  border: 1px solid #3a3a5e;
  border-radius: 6px;
  box-shadow: 0 8px 24px rgba(0,0,0,0.5);
}
.je-mention__item {
  display: flex;
  align-items: baseline;
  gap: 8px;
  padding: 5px 9px;
  cursor: pointer;
  font-size: 11px;
}
.je-mention__item--active,
.je-mention__item:hover { background: #23233a; }
.je-mention__item-src { color: #8fbeff; white-space: nowrap; }
.je-mention__item-path { color: #ddd; flex: 1; }
.je-mention__item-type { color: #7a7f8c; font-size: 10px; }
```

- [ ] **Step 6.2: Commit**

```bash
git add packages/flow-editor/src/styles.css
git commit -m "style(flow-editor): @-mention chip input styles"
```

---

## Task 7: Manual verification

The flow-editor package has no React test runner — manual browser verification is the acceptance gate for the contenteditable behavior.

- [ ] **Step 7.1: Start services**

```bash
npm run infra:up
npm run migrate
npm run start:api-server      # terminal 1
npm run start:worker          # terminal 2
npm run dev:web               # terminal 3
```

- [ ] **Step 7.2: Single-ref binding**

1. Open a workflow; select a step with a required binding (e.g. the "Write Implementation" step from the earlier screenshots).
2. In a required-binding field, type `@`, then a few letters of an upstream field.
3. Pick a field — confirm it renders as a chip (friendly label).
4. Open the saved flow JSON (network tab on save, or Show JSON) — confirm `node.inputs[key] = { kind: "ref", ref: "<...>" }` and no `config[key]`.

- [ ] **Step 7.3: Template (text + ref)**

1. In a string config field, type `feature/`, then `@` and pick a field, then type `-done`.
2. Confirm the field shows `feature/` + chip + `-done`.
3. Confirm saved `node.config[key] === "feature/${<ref>}-done"` and `node.inputs[key]` is absent.

- [ ] **Step 7.4: Duplicate-name id**

1. Add two Human Task nodes upstream (same default name).
2. Open the `@` dropdown on a downstream field.
3. Confirm both Human Task entries show a `#<id>` suffix; a uniquely-named source shows none.

- [ ] **Step 7.5: Chip removal + empty**

1. Backspace immediately after a chip — confirm the whole chip is deleted (not one character).
2. Clear the field entirely — confirm both `inputs[key]` and `config[key]` are removed on save.

- [ ] **Step 7.6: Excluded widgets unchanged**

1. Confirm number / boolean (checkbox) / select / secret config fields still render their original controls (no `@`, no contenteditable).

- [ ] **Step 7.7: Other surfaces untouched**

1. Open an if-else gate edge inspector — confirm its condition LHS picker still works (still uses `ValuePicker`).
2. Open a control node (loop/timer) config — confirm it still uses the `{x}` `ValuePicker`.

- [ ] **Step 7.8: Final commit (if tweaks needed)**

If 7.1–7.7 surfaced CSS/behavior tweaks, apply and commit. Otherwise skip.

---

## Self-Review Notes

- **Spec coverage:**
  - "The chip input (`MentionInput`)" → Task 3.
  - "Dropdown row format" → Task 3 (menu render) + Task 6 (styles).
  - "Flattened field list (`mention-fields.ts`)" → Task 2.
  - "Serialization" table → Task 1 (`soleRefOf`/`segmentsToTemplate`) + Task 5 (`commitSegments`).
  - "Initial render (storage → chip box)" → Task 5 (`segmentsForField`) + Task 3 (`renderInto`), stale ref → `labelForRef` fallback in Task 3.
  - "Scope" (string/bind fields only; number/bool/enum excluded) → Task 5 (`MENTION_WIDGETS`) + Task 4 (override only applied where ConfigTab returns a node).
  - "File map" → Tasks 1–6; `ValuePicker` retained (only ConfigTab's usage removed) → Task 5.5.
  - Edge cases (stale ref, free-form object, duplicate names, paste-as-text, atomic chip, read-only, excluded widgets) → covered across Tasks 2/3/5 and verified in Task 7.
- **Placeholder scan:** No TBDs; every code step has full code; every command has expected output.
- **Type consistency:** `Segment` (Task 1) consumed by Tasks 3 + 5. `MentionField` (Task 2) consumed by Tasks 3 + 5. `MentionInput` prop shape (`value`, `fields`, `onChange`, `readOnly`, `placeholder`) defined in Task 3 and matched exactly in Task 5 call sites. `renderFieldInput(key, meta)` signature defined in Task 4 and supplied in Task 5.3.
