# Accept-if Field-Path Suggestions Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the webhook-wait "Accept if" builder suggest payload paths in each rule's field-path input, like the Outputs field already does.

**Architecture:** Single-file change in `packages/flow-editor`. `AcceptIfBuilder` already receives a de-duplicated `knownPaths` prop and its field inputs already carry `list={datalistId}` — but the prop is ignored and no `<datalist>` with that id is ever rendered. The fix: render that datalist from `knownPaths`. No type, editor, or backend changes.

**Tech Stack:** React (TSX), native `<datalist>` autocomplete. Verification via `npm run check` (no DOM test harness exists for this component; the codebase only unit-tests pure logic).

---

## Background facts (verified against the codebase)

- File: `packages/flow-editor/src/properties-panel/AcceptIfBuilder.tsx`.
- Line 25 — the prop is ignored: `export function AcceptIfBuilder({ value, knownPaths: _knownPaths, readOnly, onChange, datalistId }: Props)`.
- Lines 149–158 — each rule's field input already has `list={datalistId}`.
- The root element is `<div className="je-acceptif">` (line 104); its first child is `<div className="je-acceptif__header">` (line 105).
- The parent (`WebhookWaitConfigEditor.tsx`) passes `datalistId={`acceptif-paths-${node.id}`}` and `knownPaths={knownPaths}`, where `knownPaths = Array.from(new Set([...suggestedPaths, ...output fromPaths]))` — already de-duplicated. No `<datalist id="acceptif-paths-...">` is rendered anywhere today.
- This change is JSX + a prop rename; there is no extractable pure logic to unit-test (the codebase's `.test.ts` files cover pure functions only, run via `npx tsx <file>`). Verification is `npm run check` + manual.

---

## Task 1: Render the Accept-if datalist and use `knownPaths`

**Files:**
- Modify: `packages/flow-editor/src/properties-panel/AcceptIfBuilder.tsx`

- [ ] **Step 1: Stop ignoring the `knownPaths` prop**

Change the component signature (line 25). Replace:

```tsx
export function AcceptIfBuilder({ value, knownPaths: _knownPaths, readOnly, onChange, datalistId }: Props) {
```

with:

```tsx
export function AcceptIfBuilder({ value, knownPaths, readOnly, onChange, datalistId }: Props) {
```

- [ ] **Step 2: Render the datalist as the first child of the root div**

Find the start of the returned JSX (lines 103–105):

```tsx
  return (
    <div className="je-acceptif">
      <div className="je-acceptif__header">
```

Insert a `<datalist>` between the root `<div className="je-acceptif">` and the header div:

```tsx
  return (
    <div className="je-acceptif">
      <datalist id={datalistId}>
        {knownPaths.map((p) => <option key={p} value={p} />)}
      </datalist>
      <div className="je-acceptif__header">
```

- [ ] **Step 3: Typecheck the package**

Run: `npm run typecheck --workspace @journeyman/flow-editor`
Expected: PASS — no type errors. (`knownPaths` is typed `string[]` in `Props`, so `.map` over it is valid; the previously-unused-prop lint concern is resolved because it is now read.)

- [ ] **Step 4: Repo-wide check**

Run: `npm run check`
Expected: PASS — typecheck across workspaces + import-boundary check clean (`✓ Layer boundaries clean across all packages.`).

- [ ] **Step 5: Commit**

```bash
git add packages/flow-editor/src/properties-panel/AcceptIfBuilder.tsx
git commit -m "fix(flow-editor): render accept-if path datalist so field suggestions work"
```

---

## Manual verification (after Task 1)

1. `npm run dev:web`, open a workflow with a webhook-wait node that has a webhook selected.
2. In "Accept if (optional)", click "+ Add condition".
3. Focus the field-path input and confirm payload-schema paths are suggested as you type.
4. Add an Output row with a `fromPath`, then reopen the Accept-if field input and confirm that declared output path also appears among the suggestions (the editor folds output `fromPath`s into `knownPaths`).
5. With no webhook selected, confirm the input still works and simply shows no suggestions (expected — `knownPaths` is empty).

---

## Self-Review notes

- **Spec coverage:** "use the prop" (Step 1), "render the missing datalist from `knownPaths`" (Step 2), "no other changes" (only the signature + one JSX element touched), Outputs untouched, no type/backend changes. All spec points map to a step.
- **Type consistency:** `knownPaths` is `string[]` per the existing `Props` interface (line 15); the `.map((p) => <option .../>)` matches the same pattern used for the Outputs datalist in `WebhookWaitConfigEditor.tsx`. `datalistId` is the existing `string` prop, unchanged.
- **No placeholders:** every step shows exact code and exact commands.
