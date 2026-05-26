# Join: Rename, Mode Info Card, Picker Visibility — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rename `errorMode` → `mode` on the Join node everywhere; surface every reachable upstream node (including parallel branches) in the picker; expose the Join itself as a picker source per mode; replace the one-line mode description with a richer info card.

**Architecture:** Atomic rename across core + orchestrator + flow-editor + docs (no backwards-compat reads, DB is fresh). Then a small pure helper `joinSource()` plus a one-function swap inside `useUpstreamSources` (dominator walk → transitive reverse walk). Finally an in-place expansion of `JoinConfigEditor` to render structured mode info.

**Tech Stack:** TypeScript, React 18, existing `@journeyman/core` types (`JoinConfig`, `JoinMode`, `JoinNodeOutput`, `Shape`, `UpstreamSource`), `node:assert` tests run via `npx tsx`.

**Spec:** [docs/superpowers/specs/2026-05-26-join-mode-rename-and-picker-design.md](../specs/2026-05-26-join-mode-rename-and-picker-design.md)

---

## File Map

- **Modify (rename)** `packages/core/src/types/parallel.types.ts`, `packages/core/src/index.ts`, `packages/core/src/validation/validate-fork-join-pairs.ts`
- **Modify (rename)** `packages/orchestrator/src/flow-json/conductor-converter.ts`, `packages/orchestrator/src/flow-json/conductor-types.ts`, `packages/orchestrator/src/sync/first-wins-controller.ts`
- **Modify (rename)** `packages/flow-editor/src/properties-panel/JoinConfigEditor.tsx`, `packages/flow-editor/src/canvas/nodes/JoinNode.tsx`
- **Modify (rename)** `docs/parallel-and-pauses.md`
- **Create** `packages/flow-editor/src/properties-panel/join-source.ts` + `.test.ts` — pure helper + unit tests
- **Modify (picker)** `packages/flow-editor/src/properties-panel/use-upstream-sources.ts` — swap dominator computation for transitive reverse-walk; wire `joinSource()`
- **Modify (UI)** `packages/flow-editor/src/properties-panel/JoinConfigEditor.tsx` — replace `desc` strings with structured `ModeInfo` per mode and render an info card

---

## Task 1: Rename `errorMode` → `mode` everywhere

**Files:**
- Modify: `packages/core/src/types/parallel.types.ts`
- Modify: `packages/core/src/index.ts`
- Modify: `packages/core/src/validation/validate-fork-join-pairs.ts`
- Modify: `packages/orchestrator/src/flow-json/conductor-converter.ts`
- Modify: `packages/orchestrator/src/flow-json/conductor-types.ts`
- Modify: `packages/orchestrator/src/sync/first-wins-controller.ts`
- Modify: `packages/flow-editor/src/properties-panel/JoinConfigEditor.tsx`
- Modify: `packages/flow-editor/src/canvas/nodes/JoinNode.tsx`
- Modify: `docs/parallel-and-pauses.md`

Done atomically in one commit so the project stays buildable.

- [ ] **Step 1.1: Rename in `packages/core/src/types/parallel.types.ts`**

Replace the entire file with:

```ts
export type JoinMode =
  | "fail-fast"
  | "wait-all"
  | "wait-all-strict"
  | "first-wins";

export interface ForkConfig {
  description?: string;
}

export interface JoinConfig {
  /** How the join waits for branches, cancels losers, and shapes its output. Default: "fail-fast". */
  mode?: JoinMode;
  description?: string;
}

export interface JoinBranchResult {
  status: "success" | "error" | "cancelled";
  /** Output of the branch's last node, or null on error/cancellation. */
  output: Record<string, unknown> | null;
  error?: string;
}

/**
 * Shape exposed at runtime as the Join node's output. Which fields are
 * populated depends on the Join's `mode`:
 *   - `fail-fast`: no fields (the workflow either continues with no join
 *     payload or has failed).
 *   - `wait-all` / `wait-all-strict`: `results` keyed by each branch's head
 *     node id.
 *   - `first-wins`: `winner` is the branch head node id and `output` is the
 *     winning branch's last node's output. `results` is present and contains
 *     only the winning branch's entry.
 */
export interface JoinNodeOutput {
  winner?: string;
  output?: Record<string, unknown>;
  results?: Record<string, JoinBranchResult>;
}
```

- [ ] **Step 1.2: Update the re-export in `packages/core/src/index.ts`**

Run: `grep -n "JoinErrorMode" packages/core/src/index.ts`

Replace `JoinErrorMode` with `JoinMode` in the re-export line. Example: if the line reads `  JoinErrorMode,` change it to `  JoinMode,`.

- [ ] **Step 1.3: Update `packages/core/src/validation/validate-fork-join-pairs.ts`**

Two changes:
1. The `import type { JoinConfig, JoinErrorMode }` line becomes `import type { JoinConfig, JoinMode }`.
2. Line ~106 currently reads:
   ```ts
   const mode: JoinErrorMode = joinCfg.errorMode ?? "fail-fast";
   ```
   Change to:
   ```ts
   const mode: JoinMode = joinCfg.mode ?? "fail-fast";
   ```

- [ ] **Step 1.4: Update `packages/orchestrator/src/flow-json/conductor-types.ts`**

Line ~41 currently reads:
```ts
    errorMode?: "fail-fast" | "wait-all" | "wait-all-strict" | "first-wins";
```
Change to:
```ts
    mode?: "fail-fast" | "wait-all" | "wait-all-strict" | "first-wins";
```

- [ ] **Step 1.5: Update `packages/orchestrator/src/flow-json/conductor-converter.ts`**

Two changes around lines 525–548:
1. `const errorMode = cfg.errorMode ?? "fail-fast";` → `const mode = cfg.mode ?? "fail-fast";`
2. The `inputParameters` object literal currently spreads `errorMode,` — change to `mode,`.

After the edit the surrounding block should look like:
```ts
    const cfg = (node.config ?? {}) as Partial<import("@journeyman/core").JoinConfig>;
    const mode = cfg.mode ?? "fail-fast";

    const branchTaskRefs: string[][] = (this.outgoing.get(forkId) ?? []).map(e => {
      ...
    });

    const join: JoinTask = {
      type: "JOIN",
      name: `join_${node.id}`,
      taskReferenceName: node.id,
      joinOn,
      inputParameters: {
        mode,
        branchTaskRefs,
        ...(cfg.description ? { description: cfg.description } : {}),
      },
    };
```

- [ ] **Step 1.6: Update `packages/orchestrator/src/sync/first-wins-controller.ts`**

Two changes:
1. The block-comment on lines 3–11 mentions `errorMode === "first-wins"` — update to `mode === "first-wins"`.
2. Lines 25–30 currently read:
   ```ts
       const params = (join.inputData ?? {}) as {
         errorMode?: string;
         branchTaskRefs?: string[][];
         joinOn?: string[];
       };
       if (params.errorMode !== "first-wins") continue;
   ```
   Change to:
   ```ts
       const params = (join.inputData ?? {}) as {
         mode?: string;
         branchTaskRefs?: string[][];
         joinOn?: string[];
       };
       if (params.mode !== "first-wins") continue;
   ```

- [ ] **Step 1.7: Update `packages/flow-editor/src/canvas/nodes/JoinNode.tsx`**

Replace the file with:

```tsx
import { Handle, Position, type NodeProps } from "@xyflow/react";
import { handleBlue } from "../handle-styles.ts";
import { NodeIssueBadges } from "./NodeIssueBadges.tsx";

export interface JoinNodeData {
  displayName?: string;
  // Canvas adapter (Canvas.tsx#toReactWorkflowNodes) spreads node.config onto
  // data for non-step nodes — so `mode` lives at data root.
  mode?: "fail-fast" | "wait-all" | "wait-all-strict" | "first-wins";
  pendingBranches?: number;
  [key: string]: unknown;
}

const MODE_LABEL: Record<string, string> = {
  "fail-fast": "fail-fast",
  "wait-all": "wait-all",
  "wait-all-strict": "wait-all (strict)",
  "first-wins": "first-wins",
};

export function JoinNode(props: NodeProps) {
  const data = props.data as JoinNodeData;
  const mode = data.mode ?? "fail-fast";
  return (
    <div className="je-node je-node--gateway je-node--join">
      <NodeIssueBadges nodeId={props.id} />
      <Handle type="target" position={Position.Left} style={handleBlue} />
      <div className="je-node__icon">⋈</div>
      <div className="je-node__text">
        <div className="je-node__label">{data.displayName ?? "Join"}</div>
        <div className="je-node__subtitle">{MODE_LABEL[mode]}</div>
      </div>
      <Handle type="source" position={Position.Right} id="default" style={handleBlue} />
    </div>
  );
}
```

- [ ] **Step 1.8: Update `packages/flow-editor/src/properties-panel/JoinConfigEditor.tsx` (rename only, info card comes in Task 4)**

Replace the file with the following. This keeps the existing one-line `desc` UX intact — Task 4 expands it.

```tsx
import type { WorkflowGraph, WorkflowNode, JoinMode } from "@journeyman/core";

interface Props {
  flow: WorkflowGraph;
  node: WorkflowNode;
  onChange: (next: WorkflowNode) => void;
  readOnly?: boolean;
}

const MODE_OPTIONS: Array<{ value: JoinMode; label: string; desc: string }> = [
  { value: "fail-fast", label: "Fail fast", desc: "First branch error cancels the others and fails the workflow." },
  { value: "wait-all", label: "Wait for all", desc: "Let every branch finish. Workflow fails only if all branches failed." },
  { value: "wait-all-strict", label: "Wait for all (strict)", desc: "Let every branch finish. Workflow fails if any branch failed." },
  { value: "first-wins", label: "First wins", desc: "First branch to succeed wins; others are cancelled. v1: branches must contain only pause nodes (human-task, webhook-wait, timer)." },
];

export function JoinConfigEditor({ flow, node, onChange, readOnly }: Props) {
  const cfg = (node.config ?? {}) as { mode?: JoinMode; description?: string };
  const mode: JoinMode = cfg.mode ?? "fail-fast";
  const incomingBranches = flow.edges.filter(e => e.target === node.id).length;

  const update = (patch: Partial<typeof cfg>) => onChange({ ...node, config: { ...cfg, ...patch } });

  return (
    <div className="je-tab je-tab--config">
      <div className="je-field">
        <label className="je-field__label">Mode</label>
        <select
          value={mode}
          disabled={readOnly}
          onChange={e => update({ mode: e.target.value as JoinMode })}
        >
          {MODE_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
        <p className="je-hint">{MODE_OPTIONS.find(o => o.value === mode)?.desc}</p>
      </div>
      {mode === "first-wins" && (
        <div className="je-field je-hint--warn">
          <strong>v1 restriction:</strong> first-wins branches may contain only pause nodes (human-task, webhook-wait, timer).
          Step nodes are not allowed and will be flagged in validation.
        </div>
      )}
      <div className="je-field">
        <label className="je-field__label">Description</label>
        <textarea
          rows={2}
          value={cfg.description ?? ""}
          disabled={readOnly}
          placeholder="What this join is waiting for."
          onChange={e => update({ description: e.target.value || undefined })}
        />
      </div>
      <div className="je-field">
        <label className="je-field__label">Incoming branches</label>
        <p className="je-hint">{incomingBranches} incoming branch{incomingBranches === 1 ? "" : "es"}.</p>
      </div>
      <div className="je-field">
        <label className="je-field__label">Output shape</label>
        <pre className="je-code-block">{outputShapeFor(mode)}</pre>
      </div>
    </div>
  );
}

function outputShapeFor(mode: JoinMode): string {
  if (mode === "fail-fast") return "// no Join-level output; reference branch nodes by id, e.g. stepA.field";
  if (mode === "first-wins") return JSON.stringify({ winner: "<branchHeadNodeId>", output: "<winning branch's last node output>" }, null, 2);
  return JSON.stringify({ results: { "<branchHeadNodeId>": { status: "success | error | cancelled", output: "<...>" } } }, null, 2);
}
```

- [ ] **Step 1.9: Update `docs/parallel-and-pauses.md`**

Run: `grep -n "errorMode" docs/parallel-and-pauses.md`

For every match (expect at least line 215), replace `errorMode` with `mode`. Preserve surrounding quotes/punctuation. Example:
- Before: `- Join: \`errorMode: "first-wins"\`.`
- After:  `- Join: \`mode: "first-wins"\`.`

- [ ] **Step 1.10: Typecheck + boundary check**

Run: `npm run typecheck`
Expected: clean exit across all workspaces.

Run: `npm run check:boundaries`
Expected: `✓ Layer boundaries clean across all packages.`

If typecheck fails, search for any remaining `errorMode` or `JoinErrorMode` strings:
```bash
grep -rn "errorMode\|JoinErrorMode" packages/ --include="*.ts" --include="*.tsx" | grep -v node_modules
```
Expected: no results (the only matches should be in historical docs under `docs/superpowers/{specs,plans}/2026-05-2*`, which are intentionally frozen).

- [ ] **Step 1.11: Commit**

```bash
git add packages/core/src/types/parallel.types.ts packages/core/src/index.ts packages/core/src/validation/validate-fork-join-pairs.ts packages/orchestrator/src/flow-json/conductor-converter.ts packages/orchestrator/src/flow-json/conductor-types.ts packages/orchestrator/src/sync/first-wins-controller.ts packages/flow-editor/src/properties-panel/JoinConfigEditor.tsx packages/flow-editor/src/canvas/nodes/JoinNode.tsx docs/parallel-and-pauses.md
git commit -m "refactor: rename Join errorMode -> mode across code and docs"
```

---

## Task 2: Pure helper — `joinSource`

**Files:**
- Create: `packages/flow-editor/src/properties-panel/join-source.ts`
- Create: `packages/flow-editor/src/properties-panel/join-source.test.ts`

Returns an `UpstreamSource` exposing the fields *unique to the Join* per mode:
- `fail-fast` → `null` (no source; branch outputs are already direct-ref)
- `wait-all` / `wait-all-strict` → `{ results: object }`
- `first-wins` → `{ winner: string, output: object, results: object }`

All fields use `scope: "output"` so refs come out as `${joinId.output.results}`, `${joinId.output.winner}`, etc.

- [ ] **Step 2.1: Write the failing test file**

Create `packages/flow-editor/src/properties-panel/join-source.test.ts`:

```ts
import assert from "node:assert/strict";
import type { WorkflowNode } from "@journeyman/core";
import { joinSource } from "./join-source.ts";

function group(src: ReturnType<typeof joinSource>, title: string) {
  assert.ok(src, "expected source");
  const g = src!.groups.find(x => x.title === title);
  assert.ok(g, `expected group ${title}`);
  return g!;
}

// === fail-fast (default) → null ===
{
  const node: WorkflowNode = { id: "j1", type: "join", config: { mode: "fail-fast" } };
  assert.equal(joinSource(node), null);
}
{
  const node: WorkflowNode = { id: "j1", type: "join" };
  assert.equal(joinSource(node), null);
}

// === wait-all → results only ===
{
  const node: WorkflowNode = {
    id: "j2",
    type: "join",
    displayName: "Wait for branches",
    config: { mode: "wait-all" },
  };
  const src = joinSource(node);
  assert.ok(src);
  assert.equal(src!.id, "j2");
  assert.equal(src!.label, "Wait for branches");
  const outs = group(src, "Outputs");
  assert.deepEqual(outs.fields.map(f => [f.name, f.shape]), [
    ["results", { type: "object", fields: {} }],
  ]);
}

// === wait-all-strict → results only ===
{
  const node: WorkflowNode = { id: "j3", type: "join", config: { mode: "wait-all-strict" } };
  const src = joinSource(node);
  assert.ok(src);
  assert.equal(src!.label, "Join"); // default label
  const outs = group(src, "Outputs");
  assert.deepEqual(outs.fields.map(f => f.name), ["results"]);
}

// === first-wins → winner + output + results ===
{
  const node: WorkflowNode = { id: "j4", type: "join", config: { mode: "first-wins" } };
  const src = joinSource(node);
  assert.ok(src);
  const outs = group(src, "Outputs");
  assert.deepEqual(outs.fields.map(f => [f.name, f.shape]), [
    ["winner",  { type: "string" }],
    ["output",  { type: "object", fields: {} }],
    ["results", { type: "object", fields: {} }],
  ]);
}

// === non-join node returns null ===
{
  const node: WorkflowNode = { id: "s1", type: "step", stepType: "clone-repos" };
  assert.equal(joinSource(node), null);
}
{
  const node: WorkflowNode = { id: "t1", type: "trigger-manual" };
  assert.equal(joinSource(node), null);
}

console.log("join-source: ok");
```

- [ ] **Step 2.2: Run test to verify it fails**

Run: `npx tsx packages/flow-editor/src/properties-panel/join-source.test.ts`
Expected: FAIL — `Cannot find module '.../join-source.ts'`.

- [ ] **Step 2.3: Implement the helper**

Create `packages/flow-editor/src/properties-panel/join-source.ts`:

```ts
import type { WorkflowNode, Shape, JoinMode } from "@journeyman/core";
import type { UpstreamSource, UpstreamField } from "./use-upstream-sources.ts";

function field(name: string, shape: Shape): UpstreamField {
  return { name, scope: "output", shape };
}

/**
 * Build an UpstreamSource for a `join` node, exposing only the fields unique
 * to the Join. Branch outputs are referenceable directly by branch-node id,
 * so we don't surface them again here. Returns null for non-Join nodes and
 * for `fail-fast` joins (which contribute no Join-level fields).
 */
export function joinSource(node: WorkflowNode): UpstreamSource | null {
  if (node.type !== "join") return null;

  const cfg = (node.config ?? {}) as { mode?: JoinMode };
  const mode: JoinMode = cfg.mode ?? "fail-fast";
  if (mode === "fail-fast") return null;

  const fields: UpstreamField[] = [];
  if (mode === "first-wins") {
    fields.push(field("winner", { type: "string" } as Shape));
    fields.push(field("output", { type: "object", fields: {} } as Shape));
  }
  fields.push(field("results", { type: "object", fields: {} } as Shape));

  return {
    kind: "node",
    id: node.id,
    label: node.displayName ?? "Join",
    groups: [{ title: "Outputs", scope: "output", fields }],
  };
}
```

- [ ] **Step 2.4: Run test to verify it passes**

Run: `npx tsx packages/flow-editor/src/properties-panel/join-source.test.ts`
Expected: `join-source: ok`

- [ ] **Step 2.5: Typecheck**

Run: `npm run typecheck -w @journeyman/flow-editor`
Expected: clean exit.

- [ ] **Step 2.6: Commit**

```bash
git add packages/flow-editor/src/properties-panel/join-source.ts packages/flow-editor/src/properties-panel/join-source.test.ts
git commit -m "feat(flow-editor): add joinSource helper exposing per-mode Join fields"
```

---

## Task 3: Switch `useUpstreamSources` to transitive walk + wire `joinSource`

**Files:**
- Modify: `packages/flow-editor/src/properties-panel/use-upstream-sources.ts`

Replace the dominator-set fixed-point loop with a simple transitive reverse-walk through predecessors. Wire `joinSource` into the per-node iteration so any reachable Join contributes its source (in addition to its branch nodes which now appear via the looser walk).

- [ ] **Step 3.1: Add the import**

In `packages/flow-editor/src/properties-panel/use-upstream-sources.ts`, add this import near the existing imports at the top of the file (next to the `pauseNodeSource` import added in the previous feature):

```ts
import { joinSource } from "./join-source.ts";
```

- [ ] **Step 3.2: Replace the dominator computation with a transitive reverse-walk**

Locate the existing block that builds `dom` and computes `upstream` — it spans from the `const allIds = new Set(...)` line through `const upstream = [...(dom.get(nodeId) ?? new Set())].filter(id => id !== nodeId);` (approximately lines 41–85 of the current file).

Replace that entire block with:

```ts
    // Transitive reverse-walk through predecessors. Includes every node
    // reachable backward through edges, regardless of branching topology.
    // For parallel Fork+Join graphs this exposes all branches' nodes;
    // for XOR If/Else the branch siblings also appear (engine returns
    // undefined for refs to branches that didn't run).
    const preds = new Map<string, string[]>();
    for (const e of graph.edges) {
      const arr = preds.get(e.target) ?? [];
      arr.push(e.source);
      preds.set(e.target, arr);
    }
    const seen = new Set<string>();
    const upstream: string[] = [];
    const stack: string[] = [...(preds.get(nodeId) ?? [])];
    while (stack.length) {
      const id = stack.pop()!;
      if (seen.has(id)) continue;
      seen.add(id);
      upstream.push(id);
      for (const p of preds.get(id) ?? []) stack.push(p);
    }
```

- [ ] **Step 3.3: Wire `joinSource` into the per-node iteration**

The current loop body has a pause-node branch (added in the previous feature) and a step branch. Add a Join branch immediately after the pause-node branch, before the `if (n.type !== "step" || !n.stepType) continue;` line.

The relevant block should end up looking like:

```ts
    for (const id of upstream) {
      const n = graph.nodes.find(x => x.id === id);
      if (!n) continue;

      if (n.type === "human-task" || n.type === "webhook-wait") {
        const src = pauseNodeSource(n);
        if (src) sources.push(src);
        continue;
      }

      if (n.type === "join") {
        const src = joinSource(n);
        if (src) sources.push(src);
        continue;
      }

      if (n.type !== "step" || !n.stepType) continue;
      // ... existing step-handling code unchanged ...
```

- [ ] **Step 3.4: Drop the now-unused dominator-loop diagnostic**

The deleted block previously included a `console.error("[useUpstreamSources] dominator loop did not converge", …)` diagnostic. Since the dominator loop no longer exists, that diagnostic is gone with it — no further action needed for this step beyond confirming Step 3.2 removed it.

- [ ] **Step 3.5: Typecheck + boundary check**

Run: `npm run typecheck -w @journeyman/flow-editor`
Expected: clean exit.

Run: `npm run check:boundaries`
Expected: `✓ Layer boundaries clean across all packages.`

- [ ] **Step 3.6: Rerun the helper tests**

Run:
```bash
npx tsx packages/flow-editor/src/properties-panel/join-source.test.ts
npx tsx packages/flow-editor/src/properties-panel/pause-node-source.test.ts
npx tsx packages/flow-editor/src/inspector/shape-for-ref.test.ts
```
Expected: each ends with its own `: ok` line.

- [ ] **Step 3.7: Commit**

```bash
git add packages/flow-editor/src/properties-panel/use-upstream-sources.ts
git commit -m "feat(flow-editor): picker shows all reachable upstream nodes + Join source"
```

---

## Task 4: Rich mode info card in `JoinConfigEditor`

**Files:**
- Modify: `packages/flow-editor/src/properties-panel/JoinConfigEditor.tsx`
- Modify: `packages/flow-editor/src/styles.css` (one small class)

Replace the single-string `desc` per mode with a structured `ModeInfo` object containing three sections: how it runs, what downstream sees, when to use it. Render below the `<select>` as a card. The existing `outputShapeFor(mode)` pretty-printed JSON block stays as-is.

- [ ] **Step 4.1: Update `packages/flow-editor/src/properties-panel/JoinConfigEditor.tsx`**

Replace the entire file with:

```tsx
import type { WorkflowGraph, WorkflowNode, JoinMode } from "@journeyman/core";

interface Props {
  flow: WorkflowGraph;
  node: WorkflowNode;
  onChange: (next: WorkflowNode) => void;
  readOnly?: boolean;
}

interface DownstreamRow {
  ref: string;
  when: string;
}

interface ModeInfo {
  value: JoinMode;
  label: string;
  howItRuns: string;
  downstreamSees: DownstreamRow[];
  whenToUse: string;
}

const MODE_INFO: ModeInfo[] = [
  {
    value: "fail-fast",
    label: "Fail fast",
    howItRuns:
      "All branches run in parallel. If any branch fails, the workflow fails immediately and the other branches are cancelled. If all branches succeed, downstream runs.",
    downstreamSees: [
      { ref: "${branchNodeId.output.<field>}", when: "Always defined (all branches must succeed for downstream to run)" },
      { ref: "${joinId.output.*}", when: "Nothing — Join contributes no extra fields in this mode" },
    ],
    whenToUse: "Use when all branches must succeed and a single failure should abort the whole workflow.",
  },
  {
    value: "wait-all",
    label: "Wait for all",
    howItRuns:
      "All branches run to completion, even if some fail. Downstream runs after every branch has finished, regardless of which succeeded.",
    downstreamSees: [
      { ref: "${branchNodeId.output.<field>}", when: "Defined if that branch succeeded; undefined if it failed" },
      { ref: "${joinId.output.results}", when: "Full bag keyed by branch head node id, each { status, output, error? }" },
      { ref: "${joinId.output.results.<branchHeadId>.status}", when: 'Always defined — "success" | "error" | "cancelled"' },
    ],
    whenToUse: "Use when you want every branch's outcome (success or failure) and will react to it downstream.",
  },
  {
    value: "wait-all-strict",
    label: "Wait for all (strict)",
    howItRuns:
      "All branches run to completion. After the Join, if any branch failed, the workflow ends as failed and downstream does NOT run. Otherwise downstream runs normally.",
    downstreamSees: [
      { ref: "${branchNodeId.output.<field>}", when: "Always defined (downstream only runs if every branch succeeded)" },
      { ref: "${joinId.output.results}", when: "Full bag of branch results — all entries have status \"success\"" },
    ],
    whenToUse:
      "Use when each branch must complete (so partial state isn't lost), but any failure should still abort the rest of the workflow.",
  },
  {
    value: "first-wins",
    label: "First wins",
    howItRuns:
      "All branches start in parallel. The first branch to finish wins; the others are cancelled. v1 restriction: branches may contain only pause nodes (human-task, webhook-wait, timer).",
    downstreamSees: [
      { ref: "${joinId.output.winner}", when: "Always defined — the winning branch's head node id" },
      { ref: "${joinId.output.output.<field>}", when: "Always defined — the winner's output (whichever branch won)" },
      { ref: "${branchNodeId.output.<field>}", when: "Only defined if THIS branch won; undefined if it lost" },
      { ref: "${joinId.output.results}", when: "Contains only the winner's entry" },
    ],
    whenToUse: "Use when racing pauses (humans, webhooks, timers) and only the first response matters.",
  },
];

const MODE_INFO_BY_VALUE: Record<JoinMode, ModeInfo> =
  Object.fromEntries(MODE_INFO.map(m => [m.value, m])) as Record<JoinMode, ModeInfo>;

export function JoinConfigEditor({ flow, node, onChange, readOnly }: Props) {
  const cfg = (node.config ?? {}) as { mode?: JoinMode; description?: string };
  const mode: JoinMode = cfg.mode ?? "fail-fast";
  const info = MODE_INFO_BY_VALUE[mode];
  const incomingBranches = flow.edges.filter(e => e.target === node.id).length;

  const update = (patch: Partial<typeof cfg>) => onChange({ ...node, config: { ...cfg, ...patch } });

  return (
    <div className="je-tab je-tab--config">
      <div className="je-field">
        <label className="je-field__label">Mode</label>
        <select
          value={mode}
          disabled={readOnly}
          onChange={e => update({ mode: e.target.value as JoinMode })}
        >
          {MODE_INFO.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
      </div>

      <div className="je-join-mode-info">
        <div className="je-join-mode-info__section">
          <div className="je-join-mode-info__heading">How it runs</div>
          <p>{info.howItRuns}</p>
        </div>
        <div className="je-join-mode-info__section">
          <div className="je-join-mode-info__heading">Downstream sees</div>
          <table className="je-join-mode-info__table">
            <tbody>
              {info.downstreamSees.map(row => (
                <tr key={row.ref}>
                  <td><code>{row.ref}</code></td>
                  <td>{row.when}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="je-join-mode-info__section">
          <div className="je-join-mode-info__heading">When to use it</div>
          <p>{info.whenToUse}</p>
        </div>
      </div>

      {mode === "first-wins" && (
        <div className="je-field je-hint--warn">
          <strong>v1 restriction:</strong> first-wins branches may contain only pause nodes (human-task, webhook-wait, timer).
          Step nodes are not allowed and will be flagged in validation.
        </div>
      )}

      <div className="je-field">
        <label className="je-field__label">Description</label>
        <textarea
          rows={2}
          value={cfg.description ?? ""}
          disabled={readOnly}
          placeholder="What this join is waiting for."
          onChange={e => update({ description: e.target.value || undefined })}
        />
      </div>
      <div className="je-field">
        <label className="je-field__label">Incoming branches</label>
        <p className="je-hint">{incomingBranches} incoming branch{incomingBranches === 1 ? "" : "es"}.</p>
      </div>
      <div className="je-field">
        <label className="je-field__label">Output shape</label>
        <pre className="je-code-block">{outputShapeFor(mode)}</pre>
      </div>
    </div>
  );
}

function outputShapeFor(mode: JoinMode): string {
  if (mode === "fail-fast") return "// no Join-level output; reference branch nodes by id, e.g. stepA.field";
  if (mode === "first-wins") return JSON.stringify({ winner: "<branchHeadNodeId>", output: "<winning branch's last node output>" }, null, 2);
  return JSON.stringify({ results: { "<branchHeadNodeId>": { status: "success | error | cancelled", output: "<...>" } } }, null, 2);
}
```

- [ ] **Step 4.2: Add CSS for the mode-info card**

Append to `packages/flow-editor/src/styles.css`:

```css
/* Join mode info card — rendered below the mode select in JoinConfigEditor. */
.je-join-mode-info {
  background: #1a1a2a;
  border: 1px solid #2a2a3a;
  border-radius: 6px;
  padding: 10px 12px;
  margin: 8px 0 12px;
  font-size: 11px;
  color: #ccc;
}
.je-join-mode-info__section + .je-join-mode-info__section {
  margin-top: 10px;
}
.je-join-mode-info__heading {
  font-size: 10px;
  font-weight: 600;
  color: #8fbeff;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  margin-bottom: 4px;
}
.je-join-mode-info p {
  margin: 0;
  line-height: 1.5;
}
.je-join-mode-info__table {
  width: 100%;
  border-collapse: collapse;
}
.je-join-mode-info__table td {
  vertical-align: top;
  padding: 3px 6px 3px 0;
}
.je-join-mode-info__table td:first-child {
  white-space: nowrap;
  width: 1%;
}
.je-join-mode-info__table code {
  background: #0e0e1a;
  border: 1px solid #2a2a3a;
  border-radius: 3px;
  padding: 1px 5px;
  font-size: 10px;
  color: #ddd;
}
```

- [ ] **Step 4.3: Typecheck**

Run: `npm run typecheck -w @journeyman/flow-editor`
Expected: clean exit.

- [ ] **Step 4.4: Commit**

```bash
git add packages/flow-editor/src/properties-panel/JoinConfigEditor.tsx packages/flow-editor/src/styles.css
git commit -m "feat(flow-editor): rich per-mode info card on Join config"
```

---

## Task 5: Manual verification

The flow-editor package has no React test runner — manual browser verification is the acceptance gate for the UI behavior.

- [ ] **Step 5.1: Start infra + services**

```bash
npm run infra:up
npm run migrate
npm run start:api-server      # in one terminal
npm run start:worker          # in another
npm run dev:web               # in another
```

- [ ] **Step 5.2: Verify rename in the editor and on the wire**

1. Create a new workflow with a Fork (parallel) + two branches + Join + downstream step.
2. Open the Join's properties panel — confirm the field is labelled **"Mode"** (not "Error mode") and the select shows the four options.
3. Save the flow; open the network tab and inspect the `PATCH`/`PUT` payload. Confirm the Join's config carries `mode: "..."` (not `errorMode`).

- [ ] **Step 5.3: Verify the mode info card**

For each of the four modes:
1. Pick the mode in the select.
2. Confirm three sections appear: **How it runs**, **Downstream sees** (table), **When to use it**.
3. Confirm the existing `Output shape` code block still renders below the card.
4. For `first-wins`, confirm the existing yellow v1-restriction warning still appears.

- [ ] **Step 5.4: Verify the picker shows parallel-branch nodes**

1. In the same Fork+Join workflow, add a Human Task to one branch and a Webhook Wait to the other.
2. Configure each with one declared output (Human Task: `approved: boolean`; Webhook Wait: `pr_number: number`).
3. Add a step downstream of the Join.
4. Open the step's input picker (`{x}`).
5. Confirm both the Human Task and the Webhook Wait appear as sources, with their declared outputs and `System` group (`source`, `actor`, `resolvedAt`, `payload` for Human Task; `source`, `resolvedAt`, `webhookEventId`, `payload` for Webhook Wait).

- [ ] **Step 5.5: Verify the Join source per mode**

Still on the downstream step's input picker, change the Join's mode and re-open the picker:
1. **`fail-fast`**: the Join itself does NOT appear as a source (no extra fields beyond branch direct refs).
2. **`wait-all`**: the Join appears with one field — `results`.
3. **`wait-all-strict`**: same as wait-all — `results` only.
4. **`first-wins`**: the Join appears with three fields — `winner`, `output`, `results`.

- [ ] **Step 5.6: Verify if-else condition picker still works**

1. Open an if-else gate edge inspector (from earlier work).
2. Confirm the LHS picker still opens and shows upstream nodes — including any parallel-branch nodes upstream of the gate (this is a behavior change from the previous dominator-based picker; intentional per the spec).

- [ ] **Step 5.7: Final commit (if any tweaks needed)**

If 5.1–5.6 surfaced CSS / copy tweaks, apply them and commit. Otherwise skip.

---

## Self-Review Notes

- **Spec coverage:**
  - Spec "Piece 1 — Picker shows reachable upstream" → Task 3 Steps 3.2.
  - Spec "Piece 2 — Join is its own picker source" → Tasks 2 + 3 (helper + wiring).
  - Spec "Piece 3 — Rich mode info card" → Task 4.
  - Spec "Piece 4 — Rename `errorMode` → `mode`" → Task 1.
  - Spec "No backwards-compat reads" → reflected in Task 1.10 (the grep confirms zero remaining `errorMode` in live code).
  - Spec "Out of scope" items (rollup outputs, first-wins warning, results auto-expansion) — none added to the plan. ✓
- **Placeholder scan:** No TBDs; every code step contains the full code; every command has expected output. ✓
- **Type consistency:** `JoinMode` defined in Task 1.1; used in Tasks 1.3, 1.8, 2.3, 4.1 with identical spelling. `JoinConfig.mode` used in Tasks 1.1, 1.3, 1.5, 1.8, 2.3, 4.1. `inputParameters.mode` on the Conductor task introduced in Task 1.5 and consumed in Task 1.6. ✓
