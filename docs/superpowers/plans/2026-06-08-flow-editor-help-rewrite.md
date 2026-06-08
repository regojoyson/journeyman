# Flow Editor "How to use the editor" Rewrite Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rewrite the in-app flow-editor help panel ("How to use the editor") and add a concise `docs/flow-editor.md` so both match the editor as it works today.

**Architecture:** Two presentational files change — `help-content.tsx` (the data: legends + grouped node lists + step lists) and `HelpPanel.tsx` (renders 4 workflow-oriented sections instead of 5 flat ones). A small CSS addition supports sub-headings. A new markdown guide mirrors the panel. No editor behavior, node, or style logic changes.

**Tech Stack:** React 18 + TypeScript, `@xyflow/react`, plain CSS (`styles.css`). The `@journeyman/flow-editor` package exposes only `tsc --noEmit` (`typecheck`); there is **no DOM/test runner** for presentational JSX, so verification is `typecheck` + a content-accuracy checklist against the spec acceptance criteria, plus `npm run check` at the end.

**Spec:** [docs/superpowers/specs/2026-06-08-flow-editor-help-rewrite-design.md](../specs/2026-06-08-flow-editor-help-rewrite-design.md)

---

## File Structure

- **Modify** `packages/flow-editor/src/canvas/help-content.tsx` — replace the data model. New exports: `BUILD_STEPS`, `NODE_GROUPS`, `HANDLES` (yellow row removed), `EDGES` (4 current styles), `PUBLISH_STEPS`. Remove `INTERACTIONS`, `ADDING_PARAGRAPH`, and the flat `NODES`.
- **Modify** `packages/flow-editor/src/canvas/HelpPanel.tsx` — import the new exports; render 4 sections: Build a flow, Node types (grouped), Handles & edges, Publish & read-only.
- **Modify** `packages/flow-editor/src/styles.css` — add `.je-help-panel__subhead` for group/sub-group headings.
- **Create** `docs/flow-editor.md` — concise user guide mirroring the panel.

Ground-truth source of every label/icon used below (do not invent — these are copied verbatim):
- Triggers: `packages/flow-editor/src/palette/Palette.tsx` `TRIGGER_ENTRIES` — Manual `▶`, Webhook `🪝`, Human form `📝`.
- Control: `packages/flow-editor/src/palette/built-in-categories.ts` — End `■`, If / Else `?`, XOR `×`, Fork (parallel) `+`, Join `⋈`, Human Task `⏳`, Webhook Wait `🔔`. (Loop `↻`, Wait `⏱`, Subflow `⊞` are `comingSoon: true` — **omit**.)
- Handle colors: `handle-styles.ts` + `styles.css` — blue `#4a9eff`, red `#ff7675`, transient green `.connectingfrom` `#00b894`.
- Edge styles: `canvas/edges/*` — default solid grey, conditional dashed yellow (`#fdcb6e`, label "if"), else sparse-dashed grey, error short-dashed red (`#ff7675`).

---

## Task 1: Rewrite help-content data model

**Files:**
- Modify: `packages/flow-editor/src/canvas/help-content.tsx` (full replace)

- [ ] **Step 1: Replace the file contents**

Replace the entire contents of `packages/flow-editor/src/canvas/help-content.tsx` with:

```tsx
import type { CSSProperties, ReactNode } from "react";

export interface LegendRow {
  swatch: ReactNode;
  label: string;
  desc: string;
}

export interface NodeRow {
  icon: string;
  label: string;
  desc: string;
}

export interface NodeGroup {
  title: string;
  rows: NodeRow[];
}

const dot = (color: string, glow?: string): CSSProperties => ({
  display: "inline-block",
  width: 12,
  height: 12,
  borderRadius: "50%",
  background: color,
  boxShadow: glow ? `0 0 0 3px ${glow}` : undefined,
  flex: "0 0 auto",
});

const lineSwatch = (color: string, dashed?: boolean): CSSProperties => ({
  display: "inline-block",
  width: 28,
  height: 0,
  borderTop: `2px ${dashed ? "dashed" : "solid"} ${color}`,
  flex: "0 0 auto",
  marginTop: 6,
});

// 1 — Build a flow (ordered)
export const BUILD_STEPS: string[] = [
  "Drag a node from the left \"Steps\" palette (grouped Triggers / Control / step categories) onto the canvas.",
  "Connect nodes by dragging from one handle to another — a handle turns green when it's a valid drop target.",
  "Wire failure handling by dragging from a node's red error handle.",
  "Click a node or edge to select it; its settings appear in the right panel.",
  "Drag a node to reposition; select it and press Delete to remove. The only trigger and the only End node can't be deleted.",
  "Cmd/Ctrl+S saves. Mouse-wheel zooms; drag the empty canvas to pan.",
];

// 2 — Node types (grouped; \"Coming soon\" nodes omitted)
export const NODE_GROUPS: NodeGroup[] = [
  {
    title: "Triggers (start a flow)",
    rows: [
      { icon: "▶",  label: "Manual",     desc: "Start by clicking Run or via the API." },
      { icon: "🪝", label: "Webhook",    desc: "Start when a webhook receives a matching event." },
      { icon: "📝", label: "Human form", desc: "Start when a person submits an in-app form." },
    ],
  },
  {
    title: "Steps",
    rows: [
      { icon: "⚙", label: "Step", desc: "A unit of work from the step catalog. Each step type has its own icon." },
    ],
  },
  {
    title: "Control",
    rows: [
      { icon: "■",  label: "End",         desc: "Terminal node — sets an outcome label. A flow may have several." },
      { icon: "?",  label: "If / Else",   desc: "Branch on a condition (then / else)." },
      { icon: "×",  label: "XOR",         desc: "Exactly one branch is taken." },
      { icon: "+",  label: "Fork",        desc: "Split the flow into parallel branches." },
      { icon: "⋈",  label: "Join",        desc: "Wait for parallel branches; choose how to handle errors." },
      { icon: "⏳", label: "Human Task",  desc: "Pause for a person to fill a form; optionally notify them." },
      { icon: "🔔", label: "Webhook Wait", desc: "Pause until a matching provider webhook arrives." },
    ],
  },
];

// 3a — Handles legend
export const HANDLES: LegendRow[] = [
  { swatch: <span style={dot("#4a9eff")} />, label: "Blue dot",
    desc: "Flow input/output. Drag from one to another node to connect." },
  { swatch: <span style={dot("#ff7675")} />, label: "Red dot",
    desc: "Error output. Connect to the node that handles failures for this step." },
  { swatch: <span style={dot("#00b894", "rgba(0,184,148,0.55)")} />, label: "Green glow",
    desc: "Transient — appears while you're dragging a connection. Means \"valid drop target\"." },
];

// 3b — Edges legend
export const EDGES: LegendRow[] = [
  { swatch: <span style={lineSwatch("#888")} />,        label: "Solid grey",   desc: "Default flow." },
  { swatch: <span style={lineSwatch("#fdcb6e", true)} />, label: "Dashed yellow", desc: "Conditional branch (labeled \"if\")." },
  { swatch: <span style={lineSwatch("#888", true)} />,   label: "Dashed grey",  desc: "Else branch." },
  { swatch: <span style={lineSwatch("#ff7675", true)} />, label: "Dashed red",  desc: "Error path." },
];

// 4 — Publish & read-only
export const PUBLISH_STEPS: string[] = [
  "A flow is Draft (editable) or Ready (published). Publish from the topbar button.",
  "A Ready flow's canvas is read-only — use \"Move to Draft\" to edit it again.",
  "\"● unsaved\" in the topbar marks changes you haven't saved yet.",
];
```

- [ ] **Step 2: Typecheck the package**

Run: `npm run typecheck -w @journeyman/flow-editor`
Expected: PASS (no errors). At this point `HelpPanel.tsx` still imports the old names (`INTERACTIONS`, `ADDING_PARAGRAPH`, `NODES`), so this command **will fail** with "has no exported member" errors for those names — that is expected and is fixed in Task 2. Confirm the only errors are those missing-export errors in `HelpPanel.tsx` and nothing inside `help-content.tsx` itself.

- [ ] **Step 3: Commit**

```bash
git add packages/flow-editor/src/canvas/help-content.tsx
git commit -m "feat(flow-editor): rewrite help-panel data for current editor model"
```

---

## Task 2: Render the 4 workflow sections in HelpPanel

**Files:**
- Modify: `packages/flow-editor/src/canvas/HelpPanel.tsx`

- [ ] **Step 1: Update the import**

Replace the import block at the top of `packages/flow-editor/src/canvas/HelpPanel.tsx`:

```tsx
import {
  HANDLES, NODES, EDGES, INTERACTIONS, ADDING_PARAGRAPH,
  type LegendRow, type NodeRow,
} from "./help-content.tsx";
```

with:

```tsx
import {
  BUILD_STEPS, NODE_GROUPS, HANDLES, EDGES, PUBLISH_STEPS,
  type LegendRow, type NodeRow,
} from "./help-content.tsx";
```

- [ ] **Step 2: Replace the panel body**

Replace the `<div className="je-help-panel__body"> … </div>` block (the five `<Section>` elements currently inside it) with these four sections:

```tsx
        <div className="je-help-panel__body">
          <Section title="Build a flow">
            <ol className="je-help-panel__list">
              {BUILD_STEPS.map(s => <li key={s}>{s}</li>)}
            </ol>
          </Section>
          <Section title="Node types">
            {NODE_GROUPS.map(g => (
              <div key={g.title}>
                <div className="je-help-panel__subhead">{g.title}</div>
                {g.rows.map(n => <NodeItem key={n.label} row={n} />)}
              </div>
            ))}
          </Section>
          <Section title="Handles &amp; edges">
            <div className="je-help-panel__subhead">Handles</div>
            {HANDLES.map(r => <LegendItem key={r.label} row={r} />)}
            <div className="je-help-panel__subhead">Edges</div>
            {EDGES.map(r => <LegendItem key={r.label} row={r} />)}
          </Section>
          <Section title="Publish &amp; read-only">
            <ul className="je-help-panel__list">
              {PUBLISH_STEPS.map(s => <li key={s}>{s}</li>)}
            </ul>
          </Section>
        </div>
```

Leave the `Section`, `LegendItem`, and `NodeItem` helper components and the `<header>` / `<footer>` unchanged. (`NodeItem` and `LegendItem` are still used; `INTERACTIONS`/`ADDING_PARAGRAPH`/`NODES` are no longer referenced.)

- [ ] **Step 3: Typecheck the package**

Run: `npm run typecheck -w @journeyman/flow-editor`
Expected: PASS, no errors. (Confirms no dangling references to the removed exports and that `NodeRow`/`LegendRow` usage still type-checks.)

- [ ] **Step 4: Commit**

```bash
git add packages/flow-editor/src/canvas/HelpPanel.tsx
git commit -m "feat(flow-editor): render 4 workflow-oriented help sections"
```

---

## Task 3: Add sub-heading CSS

**Files:**
- Modify: `packages/flow-editor/src/styles.css`

- [ ] **Step 1: Add the sub-heading rule**

In `packages/flow-editor/src/styles.css`, immediately after the `.je-help-panel__section h3 { … }` rule (the block that ends around line 754), add:

```css
.je-help-panel__subhead {
  font-size: 11px;
  font-weight: 600;
  color: #bbb;
  margin: 12px 0 6px;
}
.je-help-panel__subhead:first-child {
  margin-top: 0;
}
```

- [ ] **Step 2: Typecheck (sanity — CSS has no type impact, confirm nothing else broke)**

Run: `npm run typecheck -w @journeyman/flow-editor`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add packages/flow-editor/src/styles.css
git commit -m "style(flow-editor): help-panel sub-heading for grouped sections"
```

---

## Task 4: Write docs/flow-editor.md

**Files:**
- Create: `docs/flow-editor.md`

- [ ] **Step 1: Create the guide**

Create `docs/flow-editor.md` with:

```markdown
# Using the Flow Editor

The flow editor is the n8n-style canvas where you build a flow by dragging nodes and wiring them together. This guide covers the day-to-day mechanics. The same summary is available in-app via the **?** button (top-right of the canvas).

## Building a flow

1. **Add a node** — drag any item from the left **Steps** palette onto the canvas. The palette is grouped into Triggers, Control nodes, and your step categories.
2. **Connect nodes** — drag from one node's handle to another's. A handle turns **green** while you drag when it's a valid drop target.
3. **Handle failures** — drag from a node's **red** error handle to the node that should run when the step fails.
4. **Edit a node** — click a node or edge to select it; its settings open in the right-hand panel.
5. **Move & delete** — drag a node to reposition it; select it and press **Delete** to remove it. The only trigger and the only End node are protected and can't be deleted.
6. **Save & navigate** — **Cmd/Ctrl+S** saves. The mouse wheel zooms; dragging the empty canvas pans.

## Node types

### Triggers (start a flow)

| Icon | Node | Purpose |
|---|---|---|
| ▶ | Manual | Start by clicking Run or via the API. |
| 🪝 | Webhook | Start when a webhook receives a matching event. |
| 📝 | Human form | Start when a person submits an in-app form. |

### Steps

| Icon | Node | Purpose |
|---|---|---|
| ⚙ | Step | A unit of work from the step catalog. Each step type has its own icon. |

### Control

| Icon | Node | Purpose |
|---|---|---|
| ■ | End | Terminal node — sets an outcome label. A flow may have several. |
| ? | If / Else | Branch on a condition (then / else). |
| × | XOR | Exactly one branch is taken. |
| + | Fork | Split the flow into parallel branches. |
| ⋈ | Join | Wait for parallel branches; choose how to handle errors. |
| ⏳ | Human Task | Pause for a person to fill a form; optionally notify them. |
| 🔔 | Webhook Wait | Pause until a matching provider webhook arrives. |

## Handles & edges

**Handles** (the dots on a node):

- **Blue** — flow input/output. Drag from one to another node to connect.
- **Red** — error output. Connect to the node that handles failures.
- **Green glow** — transient; shown while you drag, meaning "valid drop target".

**Edges** (the lines between nodes):

- **Solid grey** — default flow.
- **Dashed yellow** — conditional branch (labeled "if").
- **Dashed grey** — else branch.
- **Dashed red** — error path.

## Publishing & read-only

A flow is either **Draft** or **Ready**:

- **Draft** — fully editable. Publish it with the **Publish** button in the topbar.
- **Ready** — published and **read-only** on the canvas. To edit again, use **Move to Draft**.

The topbar shows **● unsaved** when you have changes that haven't been saved yet.
```

- [ ] **Step 2: Commit**

```bash
git add docs/flow-editor.md
git commit -m "docs: add concise flow-editor usage guide"
```

---

## Task 5: Final verification

**Files:** none (verification only)

- [ ] **Step 1: Run the full repo check**

Run: `npm run check`
Expected: PASS — typecheck across workspaces and import-boundary check both succeed.

- [ ] **Step 2: Content-accuracy checklist (verify against the spec acceptance criteria)**

Confirm each, by reading the changed files — fix inline and re-commit if any fail:

- [ ] The panel renders exactly four sections: **Build a flow**, **Node types**, **Handles & edges**, **Publish & read-only**.
- [ ] All three trigger types are present: Manual ▶, Webhook 🪝, Human form 📝.
- [ ] Join (⋈), Human Task (⏳), and Webhook Wait (🔔) are present in the Control group.
- [ ] **No** Coming-soon node appears anywhere: grep both files and the doc for `Loop`, `Subflow`, and the standalone control "Wait" — none should be listed as a node type.
  - Run: `grep -rn "Loop\|Subflow" packages/flow-editor/src/canvas/help-content.tsx docs/flow-editor.md` → expect no matches.
- [ ] **No** yellow-*handle* reference remains. Run: `grep -rin "yellow dot\|yellow.*handle" packages/flow-editor/src/canvas/help-content.tsx docs/flow-editor.md` → expect no matches. (Yellow appears only as an **edge** color — "Dashed yellow" — which is correct.)
- [ ] Handles legend lists exactly Blue, Red, Green glow (no fourth row).
- [ ] The Publish & read-only section mentions Draft, Ready, "Move to Draft", and "● unsaved".

- [ ] **Step 3: Final commit (only if the checklist required fixes)**

```bash
git add -A
git commit -m "docs(flow-editor): content-accuracy fixes from final review"
```

---

## Notes on testing approach

This change is presentational help text. `@journeyman/flow-editor` ships only a `typecheck` script and has **no DOM test harness** (no jsdom / testing-library), and `help-content.tsx` exports JSX swatches that can't be imported by the repo's `node:assert`-style `.ts` tests. Standing up a runner for this content would be scope beyond the spec. Verification is therefore: `tsc` (catches the data-shape and rendering type errors — the real failure mode of this refactor), `npm run check` (repo-wide), and the explicit content-accuracy checklist in Task 5 keyed to the spec's acceptance criteria.
