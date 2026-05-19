# Publish Validation Clarity Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make publish-validation errors and warnings identify the offending phase/step by human-readable name, and visually separate errors from warnings in the publish modal.

**Architecture:** Add an optional `nodeLabel` field to `PublishError` populated by `validateForPublish` from `displayName / phaseType / type`. Drop the api-server's `(node ${nodeId})` string suffix in favour of the structured field. Render `nodeLabel` as a chip prefix in `PublishModal`, split the issues list into Errors / Warnings sections with counts.

**Tech Stack:** TypeScript, React, npm workspaces (`@journeyman/core`, `@journeyman/api-server`, `@journeyman/flow-editor`).

**User constraints for this plan:** No git commits. No unit tests. End with a single typecheck run across the workspace.

**Spec:** [docs/superpowers/specs/2026-05-13-publish-validation-clarity-design.md](../specs/2026-05-13-publish-validation-clarity-design.md)

---

## File Structure

| File | Action | Responsibility |
|---|---|---|
| `packages/core/src/validation/validate-for-publish.ts` | Modify | Add `nodeLabel?: string` to `PublishError`. Compute it from the `WorkflowNode` at each push site. Drop the embedded `'${node.id}'` references in messages where a `nodeId` is also being set. |
| `packages/api-server/src/routes/flows.ts` | Modify | Replace the `(node ${e.nodeId})` string suffix with `[${e.nodeLabel ?? "Flow"}]` prefix when flattening into the legacy string-array report. |
| `packages/flow-editor/src/topbar/PublishModal.tsx` | Modify | Split issues into Errors and Warnings sections with counts and sublines. Render `[nodeLabel]` chip prefix per row. Keep "Show node" button behaviour. |
| `packages/flow-editor/src/topbar/PublishModal.module.css` *or existing global stylesheet* | Modify | Add styles for `.fe-publish-chip`, `.fe-publish-section`, `.fe-publish-section-heading`. (Use the same stylesheet PublishModal already pulls from — see Task 4 Step 1.) |

---

## Task 1: Extend `PublishError` and derive `nodeLabel` in the validator

**Files:**
- Modify: `packages/core/src/validation/validate-for-publish.ts`

- [ ] **Step 1: Add `nodeLabel` to the `PublishError` type**

Edit `packages/core/src/validation/validate-for-publish.ts` lines 7–20. Replace the type with:

```ts
export type PublishError = {
  severity?: "error" | "warning"; // absent means "error"
  code:
    | "graph_invalid"
    | "no_trigger"
    | "orphan_node"
    | "missing_config"
    | "unresolved_binding"
    | "invalid_gate"
    | "dangling_reference";
  message: string;
  nodeId?: string;
  /** Human-readable label for the offending node — UI chip text. Resolved from
   *  `displayName` ?? prettified `phaseType` ?? capitalized `type`. */
  nodeLabel?: string;
  fieldPath?: string;
};
```

- [ ] **Step 2: Add `nodeLabelFor` helper near the bottom of the file**

Append after `parseRefNodeId` (after line 280):

```ts
function nodeLabelFor(node: WorkflowNode): string {
  if (node.displayName && node.displayName.trim().length > 0) return node.displayName;
  if (node.type === "phase" && node.phaseType) return prettifyPhaseType(node.phaseType);
  return capitalize(node.type);
}

function prettifyPhaseType(phaseType: string): string {
  return phaseType
    .split(/[-_]/)
    .filter(s => s.length > 0)
    .map(s => s.charAt(0).toUpperCase() + s.slice(1))
    .join(" ");
}

function capitalize(s: string): string {
  if (!s) return s;
  return s.charAt(0).toUpperCase() + s.slice(1);
}
```

- [ ] **Step 3: Populate `nodeLabel` on every push site that already sets `nodeId`**

In `pushGraphErrors` (line 78–86), change the phase-type-missing push to:

```ts
for (const node of flow.nodes) {
  if (node.type === "phase" && !node.phaseType) {
    errors.push({
      code: "graph_invalid",
      message: `Phase node is missing a phase type`,
      nodeId: node.id,
      nodeLabel: nodeLabelFor(node),
    });
  }
}
```

In `pushOrphanErrors` (lines 103–110), change to:

```ts
for (const n of flow.nodes) {
  if (!reachable.has(n.id)) {
    errors.push({
      code: "orphan_node",
      message: `Node is unreachable from start`,
      nodeId: n.id,
      nodeLabel: nodeLabelFor(n),
    });
  }
}
```

In `pushNodeErrors`, update each `errors.push` that includes `nodeId: node.id` to also set `nodeLabel: nodeLabelFor(node)`. Specifically:

(a) Unresolved binding push, lines 134–140 — replace with:

```ts
errors.push({
  code: "unresolved_binding",
  message: `Input '${slot}' references node '${referencedNodeId}' which is not upstream`,
  nodeId: node.id,
  nodeLabel: nodeLabelFor(node),
  fieldPath: `inputs.${slot}`,
});
```

(b) Gate conditional-missing push, lines 148–152:

```ts
errors.push({
  code: "invalid_gate",
  message: `Edge ${e.id} is conditional but has no condition`,
  nodeId: node.id,
  nodeLabel: nodeLabelFor(node),
});
```

(c) Gate conditional-shape push, lines 154–158:

```ts
errors.push({
  code: "invalid_gate",
  message: `Edge ${e.id} has an invalid condition shape`,
  nodeId: node.id,
  nodeLabel: nodeLabelFor(node),
});
```

(d) Custom-ai workspace push, lines 174–181:

```ts
errors.push({
  code: "missing_config",
  message:
    "Custom phase selected workspace tools (bash/read-file/write-file/edit-file/search) " +
    "but no workspaceDir input is wired on this node",
  nodeId: node.id,
  nodeLabel: nodeLabelFor(node),
  fieldPath: "inputs.workspaceDir",
});
```

(e) Phase-config validator push, lines 208–213 — drop the `Node 'xxx':` prefix from the message since the chip will carry it:

```ts
errors.push({
  code: "missing_config",
  message: `${issue.message}${path ? ` (config.${path})` : ""}`,
  nodeId: node.id,
  nodeLabel: nodeLabelFor(node),
  fieldPath: path ? `config.${path}` : "config",
});
```

(f) Secret-not-visible push, lines 222–228:

```ts
errors.push({
  severity: "warning",
  code: "dangling_reference",
  message: `Secret '${name}' (slot '${slot}') is not visible from this flow`,
  nodeId: node.id,
  nodeLabel: nodeLabelFor(node),
  fieldPath: `secretBindings.${slot}`,
});
```

(g) MCP-not-visible push, lines 236–243:

```ts
errors.push({
  severity: "warning",
  code: "dangling_reference",
  message: `MCP instance '${id}' is not visible from this flow`,
  nodeId: node.id,
  nodeLabel: nodeLabelFor(node),
  fieldPath: "config.mcpInstanceIds",
});
```

(h) Skill-not-visible push, lines 250–256:

```ts
errors.push({
  severity: "warning",
  code: "dangling_reference",
  message: `Skill '${id}' is not visible from this flow`,
  nodeId: node.id,
  nodeLabel: nodeLabelFor(node),
  fieldPath: "config.skillIds",
});
```

Leave the two flow-level pushes (`graph_invalid` start/end, `no_trigger`) untouched — they have no node and should keep no `nodeId` / no `nodeLabel`. The UI will render `[Flow]` for those.

---

## Task 2: Update the api-server string-flattening to use `nodeLabel`

**Files:**
- Modify: `packages/api-server/src/routes/flows.ts`

- [ ] **Step 1: Replace the suffix with a prefix using `nodeLabel`**

In `packages/api-server/src/routes/flows.ts` change line 370 from:

```ts
const msg = e.nodeId ? `${e.message} (node ${e.nodeId})` : e.message;
```

to:

```ts
const label = e.nodeLabel ?? (e.nodeId ? "Unknown step" : "Flow");
const msg = `[${label}] ${e.message}`;
```

This keeps the API response shape (string arrays for `report.errors / warnings / missing`) but switches the locator from the opaque id to the resolved label. The leading `[Flow]` for graph-level issues makes the row shape consistent.

---

## Task 3: Split issues into Errors / Warnings sections in `PublishModal`

**Files:**
- Modify: `packages/flow-editor/src/topbar/PublishModal.tsx`

- [ ] **Step 1: Replace the issue list with a sectioned renderer**

In `packages/flow-editor/src/topbar/PublishModal.tsx`, replace lines 100–123 (the `<>…</>` branch when `published === false`) with:

```tsx
<>
  {hardErrors.length === 0 && warnings.length === 0
    ? <p>All checks passed. Ready to publish.</p>
    : (
      <>
        {hardErrors.length > 0 && (
          <section className="fe-publish-section">
            <h3 className="fe-publish-section-heading fe-publish-section-heading--error">
              Errors ({hardErrors.length})
              <span className="fe-publish-section-subline">must fix before publish</span>
            </h3>
            <ul className="fe-publish-checklist">
              {hardErrors.map((e, i) => (
                <IssueRow key={`e-${i}`} kind="error" issue={e} onSelectNode={onSelectNode} onCancel={onCancel} />
              ))}
            </ul>
          </section>
        )}
        {warnings.length > 0 && (
          <section className="fe-publish-section">
            <h3 className="fe-publish-section-heading fe-publish-section-heading--warn">
              Warnings ({warnings.length})
              <span className="fe-publish-section-subline">publish allowed; review before running</span>
            </h3>
            <ul className="fe-publish-checklist">
              {warnings.map((e, i) => (
                <IssueRow key={`w-${i}`} kind="warning" issue={e} onSelectNode={onSelectNode} onCancel={onCancel} />
              ))}
            </ul>
          </section>
        )}
      </>
    )}
  {serverError ? <p className="fe-error">{serverError}</p> : null}
  <div className="fe-modal-actions">
    <button onClick={onCancel} disabled={busy}>Cancel</button>
    <button onClick={handleConfirm} disabled={!canPublish}>Publish</button>
  </div>
</>
```

- [ ] **Step 2: Add the `IssueRow` component above `PublishModal` in the same file**

Insert just below the `isHardError` helper (after line 16):

```tsx
function IssueRow({
  kind,
  issue,
  onSelectNode,
  onCancel,
}: {
  kind: "error" | "warning";
  issue: PublishError;
  onSelectNode: (nodeId: string) => void;
  onCancel: () => void;
}): JSX.Element {
  const icon = kind === "error" ? "✗" : "⚠";
  const className = kind === "error" ? "fe-publish-fail" : "fe-publish-warn";
  const chipLabel = issue.nodeLabel ?? "Flow";
  const clickable = Boolean(issue.nodeId);
  return (
    <li className={className}>
      <span className="fe-publish-row">
        <span className="fe-publish-icon">{icon}</span>
        <button
          type="button"
          className="fe-publish-chip"
          disabled={!clickable}
          onClick={() => {
            if (issue.nodeId) {
              onSelectNode(issue.nodeId);
              onCancel();
            }
          }}
        >
          {chipLabel}
        </button>
        <span className="fe-publish-message">{issue.message}</span>
      </span>
    </li>
  );
}
```

The chip itself is the navigation affordance — the standalone "Show node" button is removed (one click target per row, less noise). Rows with no `nodeId` show a disabled `[Flow]` chip.

- [ ] **Step 3: Replace the published-state warnings list to use the same `IssueRow`**

Replace lines 84–93 (the `issues.map` inside the `published === true` branch) with:

```tsx
<ul className="fe-publish-checklist">
  {issues.map((e, i) => (
    <IssueRow key={i} kind="warning" issue={e} onSelectNode={onSelectNode} onCancel={onCancel} />
  ))}
</ul>
```

---

## Task 4: Add styles for the chip and section headings

**Files:**
- Modify: existing PublishModal stylesheet (see Step 1).

- [ ] **Step 1: Locate the existing stylesheet**

Run from repo root:

```bash
grep -rn "fe-publish-checklist\|fe-publish-fail\|fe-publish-warn" packages/flow-editor/src --include="*.css"
```

Expected: matches in a single CSS file (likely `packages/flow-editor/src/styles.css` or similar). Use that file for Step 2. If no match is found, the existing classes are defined elsewhere — fall back to `grep -rn "fe-publish-checklist" packages/flow-editor packages/web` and use whichever file owns those classes.

- [ ] **Step 2: Append chip + section styles to that stylesheet**

Append the following block (do not modify existing rules):

```css
.fe-publish-section { margin-top: 12px; }
.fe-publish-section:first-of-type { margin-top: 0; }
.fe-publish-section-heading {
  font-size: 13px;
  font-weight: 600;
  margin: 0 0 6px 0;
  display: flex;
  align-items: baseline;
  gap: 8px;
}
.fe-publish-section-heading--error { color: #ff7675; }
.fe-publish-section-heading--warn { color: #fdcb6e; }
.fe-publish-section-subline {
  font-size: 11px;
  font-weight: 400;
  color: #888;
}
.fe-publish-row {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  flex-wrap: wrap;
}
.fe-publish-icon { width: 14px; display: inline-block; text-align: center; }
.fe-publish-chip {
  font-size: 11px;
  font-weight: 600;
  padding: 1px 6px;
  border-radius: 8px;
  border: 1px solid rgba(255, 255, 255, 0.15);
  background: rgba(255, 255, 255, 0.08);
  color: inherit;
  cursor: pointer;
  white-space: nowrap;
}
.fe-publish-chip:hover:not(:disabled) { background: rgba(255, 255, 255, 0.16); }
.fe-publish-chip:disabled { cursor: default; opacity: 0.7; }
.fe-publish-message { flex: 1 1 auto; }
```

If the existing styles are in a CSS module (filename ends in `.module.css`), translate class names to camelCase and update the JSX `className` lookups in Task 3 accordingly. Most of the codebase uses plain CSS — verify in Step 1 before assuming.

---

## Task 5: Typecheck the workspace

- [ ] **Step 1: Run typecheck**

From repo root:

```bash
npm run typecheck
```

Expected: exits 0 with no errors. If errors surface:

- `Property 'nodeLabel' does not exist on type 'PublishError'` → the type edit in Task 1 Step 1 didn't land in `@journeyman/core`'s export. Confirm `packages/core/src/index.ts` re-exports `PublishError` (it already does per line 105 of that file) and that the build sees the updated file.
- Unused imports in `PublishModal.tsx` → remove any imports orphaned by the rewrite (e.g. unused destructured props).
- CSS module / class-name typos → cross-check against Task 4 Step 2.

Fix any issues and re-run until clean.

- [ ] **Step 2: Confirm no commits were made**

Run:

```bash
git status --short
```

Expected: modified files for `packages/core/src/validation/validate-for-publish.ts`, `packages/api-server/src/routes/flows.ts`, `packages/flow-editor/src/topbar/PublishModal.tsx`, and the stylesheet from Task 4. Per the user's constraint, leave them uncommitted.

---

## Self-Review notes

- **Spec coverage:** §1 (drop `(node …)` suffix) → Task 2; §2 (`nodeLabel` field) → Task 1; §3 (chip prefix) → Task 3 + Task 4; §4 (Errors/Warnings sections) → Task 3; §5 (`[Flow]` for nodeless errors) → Task 2 (api-server) + Task 3 (IssueRow `chipLabel` fallback).
- **Open questions from the spec:** "chip-only vs chip + button" — resolved in Task 3 Step 2 (chip-only). "`[Flow]` chip styling" — uses the same neutral chip style as the rest; can be tuned later, not blocking.
- **No unit tests** per user constraint.
- **No commits** per user constraint — Task 5 Step 2 verifies.
- **Typecheck only** as the final verification — Task 5 Step 1.
