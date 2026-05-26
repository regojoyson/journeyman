# Node ID Visibility — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Surface the immutable `node.id` in two places: (1) as a click-to-copy button under the title in the properties panel header, and (2) as inline clickable links inside every validation error/warning message that bracket-quotes a node ID. Link clicks select the node AND pan/zoom the canvas to it.

**Architecture:** A small `<IssueMessage>` component tokenizes message text and turns each `(<known-node-id>)` substring into a button that calls a `focusNode(id)` helper. `focusNode` lives in `FlowEditor.tsx`, combines `setSelectedNodeId` with a `focusRequest` prop on `Canvas.tsx` (which calls React Flow's `setCenter`). The properties panel gets a separate small ID button under the title. No data-model or validator-message changes.

**Tech Stack:** React 18, `@xyflow/react` (React Flow v12), TypeScript. The `flow-editor` package has no test runner — verification is `npm run typecheck` + manual smoke in the dev server.

**Spec:** [docs/superpowers/specs/2026-05-26-show-node-id-in-properties-panel-design.md](../specs/2026-05-26-show-node-id-in-properties-panel-design.md)

---

## File Map

| File | Change |
|---|---|
| `packages/flow-editor/src/styles.css` | New CSS rules: `.je-props__title-block`, `.je-props__id`, `.je-issue-link`, `.je-issue-message` |
| `packages/flow-editor/src/properties-panel/PropertiesPanel.tsx` | Add `<NodeIdButton>` under title in both header render sites |
| `packages/flow-editor/src/issues/IssueMessage.tsx` | **New** — tokenizer + `<IssueMessage>` component |
| `packages/flow-editor/src/canvas/Canvas.tsx` | Add `focusRequest?: { nodeId: string; tick: number }` prop + effect that calls `setCenter` |
| `packages/flow-editor/src/FlowEditor.tsx` | Add `focusRequest` state + `focusNode` callback; pass through to `Canvas`, `PublishModal`, `Topbar` |
| `packages/flow-editor/src/topbar/PublishModal.tsx` | `IssueRow` renders `{issue.message}` via `<IssueMessage>` |
| `packages/flow-editor/src/topbar/Topbar.tsx` | `TopbarProps.onFocusNode?`; thread `flow` + `onFocusNode` into `SectionBody` and `SecretWarningsBody`; replace raw `{message}` with `<IssueMessage>`; make `<code>{e.nodeId}</code>` chips inside warning entry lists clickable |

---

## Task 1: CSS — header ID button + issue links

**Files:**
- Modify: `packages/flow-editor/src/styles.css`

- [ ] **Step 1: Append the new CSS rules**

Append the following block to the end of `packages/flow-editor/src/styles.css`:

```css
/* Node ID surfaced under panel title */
.je-props__title-block { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
.je-props__id {
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 11px;
  color: #6b7280;
  background: none;
  border: 0;
  padding: 0;
  cursor: pointer;
  text-align: left;
  max-width: 100%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.je-props__id:hover { color: #111827; }
.je-props__id:focus-visible { outline: 1px dashed currentColor; outline-offset: 2px; }
.je-props__id--copied { color: #16a34a; }

/* Inline clickable node IDs inside validation messages */
.je-issue-message { word-break: break-word; }
.je-issue-link {
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: inherit;
  color: #6aa3ff;
  background: none;
  border: 0;
  padding: 0;
  cursor: pointer;
  text-decoration: underline;
  text-underline-offset: 2px;
}
.je-issue-link:hover { color: #8fbeff; }
.je-issue-link:focus-visible { outline: 1px dashed currentColor; outline-offset: 2px; }
```

- [ ] **Step 2: Typecheck (sanity — no TS impact, but the package still must compile)**

Run: `npm run typecheck -w @journeyman/flow-editor`
Expected: PASS (no changes to TS).

- [ ] **Step 3: Commit**

```bash
git add packages/flow-editor/src/styles.css
git commit -m "feat(flow-editor): css for node-id button and issue-message links"
```

---

## Task 2: Properties panel — show `node.id` under title

**Files:**
- Modify: `packages/flow-editor/src/properties-panel/PropertiesPanel.tsx`

There are two header render sites in this file. Factor out a small `PanelHeader` helper to avoid drift, then use it in both spots.

- [ ] **Step 1: Add the `NodeIdButton` and `PanelHeader` helpers**

At the top of `packages/flow-editor/src/properties-panel/PropertiesPanel.tsx`, just above the first component definition (after the existing imports — keep the existing imports intact), add:

```tsx
function NodeIdButton({ id }: { id: string }): JSX.Element {
  const [copied, setCopied] = useState(false);
  const onClick = (): void => {
    try {
      void navigator.clipboard?.writeText(id);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1200);
    } catch {
      // Clipboard unavailable (insecure context). Falls back to selectable text.
    }
  };
  return (
    <button
      type="button"
      className={`je-props__id${copied ? " je-props__id--copied" : ""}`}
      onClick={onClick}
      title="Click to copy node ID"
    >
      {copied ? "Copied" : id}
    </button>
  );
}

function PanelHeader({
  node, onClose,
}: { node: { id: string; type: string; displayName?: string }; onClose?: () => void }): JSX.Element {
  return (
    <div className="je-props__header">
      <div className="je-props__title-block">
        <div className="je-props__title">{node.displayName ?? node.type}</div>
        <NodeIdButton id={node.id} />
      </div>
      {onClose ? (
        <button type="button" className="je-props__close" onClick={onClose} aria-label="Close">×</button>
      ) : null}
    </div>
  );
}
```

If `useState` isn't already in the `react` import at the top, add it.

- [ ] **Step 2: Replace trigger-header markup with `<PanelHeader>`**

Find the trigger branch around [PropertiesPanel.tsx:117-122](packages/flow-editor/src/properties-panel/PropertiesPanel.tsx:117):

```tsx
        <div className="je-props__header">
          <div className="je-props__title">{node.displayName ?? node.type}</div>
          {onClose ? (
            <button type="button" className="je-props__close" onClick={onClose} aria-label="Close">×</button>
          ) : null}
        </div>
```

Replace with:

```tsx
        <PanelHeader node={node} onClose={onClose} />
```

- [ ] **Step 3: Replace step/control-header markup with `<PanelHeader>`**

Find the second header around [PropertiesPanel.tsx:170-175](packages/flow-editor/src/properties-panel/PropertiesPanel.tsx:170):

```tsx
      <div className="je-props__header">
        <div className="je-props__title">{node.displayName ?? node.type}</div>
        {onClose ? (
          <button type="button" className="je-props__close" onClick={onClose} aria-label="Close">×</button>
        ) : null}
      </div>
```

Replace with:

```tsx
      <PanelHeader node={node} onClose={onClose} />
```

- [ ] **Step 4: Typecheck**

Run: `npm run typecheck -w @journeyman/flow-editor`
Expected: PASS.

- [ ] **Step 5: Manual smoke**

Start the dev server (e.g. `npm run dev:web`), open any flow, select any node, verify the small monospace `node.id` is visible under the title. Click it; the label briefly changes to "Copied". Paste into another field to confirm the value matches `node.id`. Repeat for a trigger node (different header branch).

- [ ] **Step 6: Commit**

```bash
git add packages/flow-editor/src/properties-panel/PropertiesPanel.tsx
git commit -m "feat(flow-editor): show node id in properties panel header"
```

---

## Task 3: `IssueMessage` component (tokenizer + render)

**Files:**
- Create: `packages/flow-editor/src/issues/IssueMessage.tsx`

- [ ] **Step 1: Create the file**

Create `packages/flow-editor/src/issues/IssueMessage.tsx` with:

```tsx
import { useMemo, type ReactElement } from "react";
import type { WorkflowGraph } from "@journeyman/core";

interface Props {
  flow: WorkflowGraph;
  message: string;
  onSelectNode: (id: string) => void;
  /** Called after a link click — e.g. to close the parent modal. */
  onAfterClick?: () => void;
}

type Token = { kind: "text"; value: string } | { kind: "id"; value: string };

/**
 * Tokenize a validation message, turning each `(<known-node-id>)` substring
 * into an `id` token. Parens are kept as plain text so the sentence still
 * reads naturally; only the bare ID becomes a link.
 *
 * Restricting matches to IDs that exist in `knownIds` prevents accidental
 * linking of arbitrary parenthetical text (e.g. "(json_logic)").
 */
export function tokenize(message: string, knownIds: Set<string>): Token[] {
  const tokens: Token[] = [];
  const re = /\(([^()]+)\)/g;
  let lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(message)) !== null) {
    const start = m.index;
    const end = re.lastIndex;
    const inner = m[1];
    if (!knownIds.has(inner)) continue;
    if (start > lastIndex) tokens.push({ kind: "text", value: message.slice(lastIndex, start) });
    tokens.push({ kind: "text", value: "(" });
    tokens.push({ kind: "id", value: inner });
    tokens.push({ kind: "text", value: ")" });
    lastIndex = end;
  }
  if (lastIndex < message.length) {
    tokens.push({ kind: "text", value: message.slice(lastIndex) });
  }
  return tokens;
}

export function IssueMessage({ flow, message, onSelectNode, onAfterClick }: Props): ReactElement {
  const knownIds = useMemo(() => new Set(flow.nodes.map(n => n.id)), [flow.nodes]);
  const parts = useMemo(() => tokenize(message, knownIds), [message, knownIds]);
  return (
    <span className="je-issue-message">
      {parts.map((p, i) =>
        p.kind === "id" ? (
          <button
            key={i}
            type="button"
            className="je-issue-link"
            onClick={() => {
              onSelectNode(p.value);
              onAfterClick?.();
            }}
          >
            {p.value}
          </button>
        ) : (
          <span key={i}>{p.value}</span>
        ),
      )}
    </span>
  );
}
```

- [ ] **Step 2: Typecheck**

Run: `npm run typecheck -w @journeyman/flow-editor`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add packages/flow-editor/src/issues/IssueMessage.tsx
git commit -m "feat(flow-editor): IssueMessage component linkifies bracketed node ids"
```

---

## Task 4: Canvas — `focusRequest` prop + `setCenter`

**Files:**
- Modify: `packages/flow-editor/src/canvas/Canvas.tsx`

- [ ] **Step 1: Extend `CanvasProps`**

At [Canvas.tsx:84-92](packages/flow-editor/src/canvas/Canvas.tsx:84), change the interface:

```ts
export interface CanvasProps {
  flow: WorkflowGraph;
  selectedNodeId: string | null;
  onChange: (next: WorkflowGraph) => void;
  onSelect: (nodeId: string | null) => void;
  onEdgeSelect?: (edgeId: string | null) => void;
  readOnly?: boolean;
  stepRunStates?: Record<string, StepRunState>;
  /**
   * Pan and zoom-in to a node. `tick` lets the same nodeId re-trigger the
   * effect when clicked twice in a row (selection alone wouldn't change).
   */
  focusRequest?: { nodeId: string; tick: number };
}
```

- [ ] **Step 2: Pull `setCenter` + `getZoom` out of `useReactFlow`**

At [Canvas.tsx:127](packages/flow-editor/src/canvas/Canvas.tsx:127), change:

```ts
  const { screenToFlowPosition } = useReactFlow();
```

to:

```ts
  const { screenToFlowPosition, setCenter, getZoom } = useReactFlow();
```

- [ ] **Step 3: Add the focus effect**

Inside `CanvasInner`, after the existing `useEffect` blocks that handle resync (search for the last `useEffect` before the `return (<ReactFlow ... />)` JSX — adjacent to the other effects already in the function body, near where `selectedNodeId` is used), append a new effect:

```tsx
  // Pan + zoom to a requested node. Triggered by FlowEditor when a link or
  // chip is clicked inside an issue message; selection alone doesn't move
  // the viewport, so without this an offscreen node looks ignored.
  useEffect(() => {
    const req = p.focusRequest;
    if (!req) return;
    const node = p.flow.nodes.find(n => n.id === req.nodeId);
    if (!node || !node.position) return;
    // Approximate node size — exact value isn't critical for centering ±half a node.
    const approxW = 240;
    const approxH = 80;
    const cx = node.position.x + approxW / 2;
    const cy = node.position.y + approxH / 2;
    const zoom = Math.max(getZoom(), 1);
    setCenter(cx, cy, { zoom, duration: 250 });
  }, [p.focusRequest, p.flow.nodes, setCenter, getZoom]);
```

- [ ] **Step 4: Typecheck**

Run: `npm run typecheck -w @journeyman/flow-editor`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/flow-editor/src/canvas/Canvas.tsx
git commit -m "feat(flow-editor): canvas focusRequest prop pans+zooms to a node"
```

---

## Task 5: FlowEditor — `focusNode` helper, plumb to Canvas/PublishModal/Topbar

**Files:**
- Modify: `packages/flow-editor/src/FlowEditor.tsx`

- [ ] **Step 1: Add `focusRequest` state and `focusNode` callback**

Inside the `FlowEditor` component body (where the other `useState` hooks live — search for `setFlowConfigOpen` or `propsWidth`), add:

```tsx
  const [focusRequest, setFocusRequest] = useState<{ nodeId: string; tick: number } | undefined>(undefined);

  const focusNode = useCallback((id: string): void => {
    s.setSelectedNodeId(id);
    setFlowConfigOpen(false);
    setFocusRequest(prev => ({ nodeId: id, tick: (prev?.tick ?? 0) + 1 }));
  }, [s]);
```

Add `useCallback` to the `react` import if not already present.

- [ ] **Step 2: Pass `focusRequest` to `Canvas`**

At [FlowEditor.tsx:217-225](packages/flow-editor/src/FlowEditor.tsx:217), add the prop:

```tsx
              <Canvas
                flow={heal.healed}
                selectedNodeId={s.selectedNodeId}
                onSelect={nodeId => { s.setSelectedNodeId(nodeId); if (nodeId) setFlowConfigOpen(false); }}
                onEdgeSelect={edgeId => { s.setSelectedEdgeId(edgeId); if (edgeId) setFlowConfigOpen(false); }}
                onChange={props.onChange}
                readOnly={effectiveReadOnly}
                stepRunStates={props.stepRunStates}
                focusRequest={focusRequest}
              />
```

- [ ] **Step 3: Replace `onSelectNode` in `PublishModal` with `focusNode`**

At [FlowEditor.tsx:296](packages/flow-editor/src/FlowEditor.tsx:296):

```tsx
            onSelectNode={(id) => { s.setSelectedNodeId(id); }}
```

becomes:

```tsx
            onSelectNode={focusNode}
```

- [ ] **Step 4: Pass `onFocusNode` to `Topbar`**

At [FlowEditor.tsx:166-188](packages/flow-editor/src/FlowEditor.tsx:166), inside the `<Topbar ...>` props block, add one new prop (anywhere among the existing props):

```tsx
          onFocusNode={focusNode}
```

(The `Topbar` will be updated to accept this in Task 7. The order of Task 6 vs Task 7 doesn't matter — but the workspace must typecheck cleanly after both are done; if you complete this task before Task 7, expect a TS error on the unknown prop. Either complete Task 7 first or accept a temporary typecheck failure between commits.)

- [ ] **Step 5: Commit (deferred typecheck — Task 7 ships the matching prop)**

```bash
git add packages/flow-editor/src/FlowEditor.tsx
git commit -m "feat(flow-editor): focusNode helper centers canvas and selects"
```

---

## Task 6: PublishModal — render messages via `IssueMessage`

**Files:**
- Modify: `packages/flow-editor/src/topbar/PublishModal.tsx`

- [ ] **Step 1: Import `IssueMessage`**

Add at the top with the other imports:

```ts
import { IssueMessage } from "../issues/IssueMessage.tsx";
```

- [ ] **Step 2: Extend `IssueRow` props to accept `flow`**

At [PublishModal.tsx:18-28](packages/flow-editor/src/topbar/PublishModal.tsx:18), change the signature:

```tsx
function IssueRow({
  kind,
  issue,
  flow,
  onSelectNode,
  onCancel,
}: {
  kind: "error" | "warning";
  issue: PublishError;
  flow: WorkflowGraph;
  onSelectNode: (nodeId: string) => void;
  onCancel: () => void;
}): JSX.Element {
```

- [ ] **Step 3: Replace the raw message span**

At [PublishModal.tsx:50](packages/flow-editor/src/topbar/PublishModal.tsx:50):

```tsx
        <span className="fe-publish-message">{issue.message}</span>
```

becomes:

```tsx
        <span className="fe-publish-message">
          <IssueMessage
            flow={flow}
            message={issue.message}
            onSelectNode={onSelectNode}
            onAfterClick={onCancel}
          />
        </span>
```

- [ ] **Step 4: Pass `flow` to every `<IssueRow>` callsite**

There are three `<IssueRow ... />` usages inside the `PublishModal` body ([PublishModal.tsx:124,147,160](packages/flow-editor/src/topbar/PublishModal.tsx:124)). Add `flow={flow}` to each, e.g.:

```tsx
                  <IssueRow key={i} kind="warning" issue={e} flow={flow} onSelectNode={onSelectNode} onCancel={onCancel} />
```

(`flow` is already a `Props` field on the modal — no plumbing needed.)

- [ ] **Step 5: Typecheck**

Run: `npm run typecheck -w @journeyman/flow-editor`
Expected: PASS (assumes Task 5 has only committed source — temporary `onFocusNode` prop on Topbar errors here ONLY if Task 7 isn't done yet. If so, do Task 7 next, then re-typecheck.)

- [ ] **Step 6: Commit**

```bash
git add packages/flow-editor/src/topbar/PublishModal.tsx
git commit -m "feat(flow-editor): publish modal linkifies node ids inside messages"
```

---

## Task 7: Topbar — `onFocusNode` prop + linkify validation/secret sections

**Files:**
- Modify: `packages/flow-editor/src/topbar/Topbar.tsx`

- [ ] **Step 1: Add the `onFocusNode` prop to `TopbarProps`**

At [Topbar.tsx:29-54](packages/flow-editor/src/topbar/Topbar.tsx:29), add inside the interface:

```ts
  /** Click handler for node-id links inside validation/secret-warning messages. */
  onFocusNode?: (nodeId: string) => void;
```

- [ ] **Step 2: Import `IssueMessage`**

Add at the top with the other imports:

```ts
import { IssueMessage } from "../issues/IssueMessage.tsx";
```

- [ ] **Step 3: Update `SectionBody` to render via `<IssueMessage>`**

Replace the function at [Topbar.tsx:547-549](packages/flow-editor/src/topbar/Topbar.tsx:547):

```tsx
function SectionBody({ items }: { items: string[] }) {
  return <ul>{items.map((m, i) => <li key={i}>{m}</li>)}</ul>;
}
```

with:

```tsx
function SectionBody({
  items, flow, onFocusNode,
}: { items: string[]; flow?: WorkflowGraph; onFocusNode?: (id: string) => void }) {
  return (
    <ul>
      {items.map((m, i) => (
        <li key={i}>
          {flow && onFocusNode
            ? <IssueMessage flow={flow} message={m} onSelectNode={onFocusNode} />
            : m}
        </li>
      ))}
    </ul>
  );
}
```

- [ ] **Step 4: Update `SecretWarningsBody` to take `flow` + `onFocusNode` and linkify**

Replace the signature line at [Topbar.tsx:551](packages/flow-editor/src/topbar/Topbar.tsx:551):

```tsx
function SecretWarningsBody({ warnings }: { warnings: WorkflowSaveWarning[] }) {
```

with:

```tsx
function SecretWarningsBody({
  warnings, flow, onFocusNode,
}: { warnings: WorkflowSaveWarning[]; flow?: WorkflowGraph; onFocusNode?: (id: string) => void }) {
  const renderMessage = (m: string): JSX.Element | string =>
    flow && onFocusNode
      ? <IssueMessage flow={flow} message={m} onSelectNode={onFocusNode} />
      : m;
  const renderNodeIdChip = (nodeId: string): JSX.Element =>
    flow && onFocusNode
      ? (
        <button
          type="button"
          className="je-issue-link"
          onClick={() => onFocusNode(nodeId)}
          style={{ fontFamily: "ui-monospace, monospace" }}
        >{nodeId}</button>
      )
      : <code>{nodeId}</code>;
```

Then inside the body, replace each occurrence of `{w.message}` (four occurrences at lines 558, 580, 595, 609) with `{renderMessage(w.message)}`.

And replace each `<code>{e.nodeId}</code>` (two occurrences inside `cross_scope_pin` and `orphan_secret_binding` `<li>`s at lines 584, 599) with `{renderNodeIdChip(e.nodeId)}`.

The `unknown_models` / `deprecated_models` branch contains `node ${e.nodeId ?? "?"}` as a template literal inside a `<li>` (line 613). Replace that branch's `<li>` content:

```tsx
                  <li key={j}>
                    <code>{e.modelId}</code> ({e.provider}) — {e.location === "workflow-default" ? "workflow default" : `node ${e.nodeId ?? "?"}`}
                  </li>
```

with:

```tsx
                  <li key={j}>
                    <code>{e.modelId}</code> ({e.provider}) — {e.location === "workflow-default"
                      ? "workflow default"
                      : <>node {e.nodeId ? renderNodeIdChip(e.nodeId) : "?"}</>}
                  </li>
```

- [ ] **Step 5: Pass `flow` + `onFocusNode` to both bodies inside the validation report**

At [Topbar.tsx:492-509](packages/flow-editor/src/topbar/Topbar.tsx:492), update each usage:

```tsx
          <CollapsibleSection title="Errors" tone="error" count={report.errors.length} defaultOpen>
            <SectionBody items={report.errors} flow={p.flow} onFocusNode={p.onFocusNode} />
          </CollapsibleSection>
```

```tsx
          <CollapsibleSection title="Missing required inputs" tone="error" count={report.missing.length} defaultOpen>
            <SectionBody items={report.missing} flow={p.flow} onFocusNode={p.onFocusNode} />
          </CollapsibleSection>
```

```tsx
          <CollapsibleSection title="Warnings" tone="warn" count={report.warnings.length} defaultOpen={false}>
            <SectionBody items={report.warnings} flow={p.flow} onFocusNode={p.onFocusNode} />
          </CollapsibleSection>
```

```tsx
          <CollapsibleSection title="Secret warnings" tone="warn" count={secretWarnings.length} defaultOpen={false}>
            <SecretWarningsBody warnings={secretWarnings} flow={p.flow} onFocusNode={p.onFocusNode} />
          </CollapsibleSection>
```

- [ ] **Step 6: Typecheck (cross-package)**

Run: `npm run typecheck -w @journeyman/flow-editor`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add packages/flow-editor/src/topbar/Topbar.tsx
git commit -m "feat(flow-editor): topbar validation & secret messages linkify node ids"
```

---

## Task 8: Cross-package typecheck + boundary check + manual verification

- [ ] **Step 1: Workspace typecheck**

Run: `npm run typecheck`
Expected: PASS across all packages.

- [ ] **Step 2: Import boundaries**

Run: `npm run check:boundaries`
Expected: PASS. (`IssueMessage.tsx` only imports from `@journeyman/core` and `react`, both allowed.)

- [ ] **Step 3: Manual smoke — Part 1 (panel ID)**

1. Start dev server (`npm run dev:web`).
2. Open a flow with at least one step.
3. Select a step. Confirm the small monospace `node.id` appears under the title.
4. Click the ID. Confirm it briefly says "Copied" and the clipboard contains the ID.
5. Tab into the ID with the keyboard, press Enter — confirm the copy fires.
6. Select a trigger node — confirm the ID also shows there.

- [ ] **Step 4: Manual smoke — Part 2 (linkified messages)**

1. Construct a flow that fails validation with errors that include node IDs. Easy options:
   - Step node with no `stepType` (yields `Step node 'X' (step_…) is missing a step type`).
   - Two `default` edges into the same non-Join step (yields the "incoming arrows" message with `(node_id)`).
   - A fork/join misconfiguration (yields a message that references two IDs).
2. Open the topbar validation report — confirm IDs in messages render underlined and blue. Click one; the modal/expander stays where it is (it's the topbar) but the canvas pans and zooms to the node, and the properties panel opens on it.
3. Open the Publish modal on the same flow — confirm the issue rows show the same linkified IDs in the message, alongside the existing chip. Click an ID inside the message; the modal closes, the canvas centers on the node, and the properties panel is open on it.
4. Click the same link a second time after manually panning away — confirm the canvas re-centers (`tick` mechanism).
5. Test a Save that yields a secret warning (`orphan_secret_binding` or `cross_scope_pin`) — confirm the `nodeId` chip inside each `<li>` entry is now a button and clicking it focuses the node.

- [ ] **Step 5: Final commit (only if any fix-ups were needed above)**

If steps 3 or 4 surfaced issues, fix them inline against the relevant task and commit. If everything works first try, no commit is needed here.

---

## Self-Review Notes

- **Spec coverage:**
  - Part 1 (panel ID button + click-to-copy) → Tasks 1–2.
  - Part 2 (`IssueMessage` component) → Task 3.
  - Part 2 (`focusNode` + canvas pan/zoom) → Tasks 4–5.
  - Part 2 (PublishModal adoption) → Task 6.
  - Part 2 (Topbar `SectionBody` + `SecretWarningsBody` adoption, including node-id chips) → Task 7.
  - Manual verification list mirrors the spec's Testing section → Task 8.
- **Out-of-scope per spec:** per-node "missing required input" badge changes (kept on canvas badges only — no task here), tab-specific deep linking, aggregating per-node warnings into the banner pipeline. Confirmed absent.
- **Type / signature consistency:** `focusRequest: { nodeId, tick }` is the same shape in `CanvasProps`, `FlowEditor` state, and the effect dep array. `onFocusNode?: (id: string) => void` is the same on `TopbarProps`, `SectionBody`, and `SecretWarningsBody`. `IssueMessage` props match between definition and all three callsites.
- **Placeholders:** none — every code step has the actual code.
