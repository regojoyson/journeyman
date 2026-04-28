# Flow Data-Flow Contract Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Wire phase outputs to phase inputs (M4 model) with editor picker (E1), output schemas, and save-time validation.

**Architecture:** Add `node.inputs` map of `FlowInputValue` (literal | ref). Converter resolves refs → Conductor `${task.output.field}` strings. Each phase declares `outputSchema`. Editor picker reads schemas via extended `/phases` catalog. Save-time validator runs three checks.

**Tech Stack:** TypeScript, React, Conductor JSON, JSONLogic.

**Constraints (user):** No unit tests. No git commits inside steps. Typecheck only at the end. Plan grouped into independent waves for parallel agent execution.

---

## Execution waves

| Wave | Tasks | Parallel? |
|---|---|---|
| W1 | T1 (core types), T2 (PhaseContext) | parallel |
| W2 | T3 (PhaseDefinition.outputSchema), T4 (converter resolveInputs + validation) | parallel after W1 |
| W3 | T5 (phases declare outputSchema — A/B/C/D split), T6 (api: catalog + save validation) | parallel after W2 |
| W4 | T7 (editor: picker), T8 (editor: start-node run inputs), T9 (editor: integrate picker into edge/loop) | parallel after W3 |
| W5 | T10 (typecheck) | last |

---

### Task T1: Core flow types

**Files:**
- Modify: `packages/core/src/types/flow.types.ts`
- Modify: `packages/core/src/index.ts`

- [ ] **Step 1.1** Replace `NodeInputBinding` with `FlowInputValue` and add `inputs?` to `FlowNode` and `runInputs?` config typedef.

In `packages/core/src/types/flow.types.ts`:

```ts
// REMOVE existing NodeInputBinding (lines ~148-150)

// ADD near top, before FlowNode:
export type FlowInputValue =
  | { kind: "literal"; value: unknown }
  | { kind: "ref"; ref: string };

export interface RunInputDef {
  name: string;
  type: "string" | "number" | "boolean" | "json";
  description?: string;
  required?: boolean;
}
```

In `FlowNode` interface, add field after `config?`:

```ts
  /** Wires from upstream nodes / run inputs. Resolved by converter to Conductor refs. */
  inputs?: Record<string, FlowInputValue>;
```

- [ ] **Step 1.2** Update `packages/core/src/index.ts` exports.

Replace the `NodeInputBinding` re-export line with:

```ts
  McpServerConfig, McpTransport, FlowInputValue, RunInputDef,
```

(remove `NodeInputBinding` from the export list).

- [ ] **Step 1.3** Search for any other importer of `NodeInputBinding`:

Run: `grep -rn "NodeInputBinding" packages/`
Expected: zero matches after edits.

---

### Task T2: PhaseContext.runInputs + OutputSchema type

**Files:**
- Modify: `packages/core/src/types/phase-handler.types.ts`

- [ ] **Step 2.1** Add `runInputs` to `PhaseContext`:

After `env: Record<string, string>;` line, add:

```ts
  /** Frozen copy of workflow.input — values declared on the start node's runInputs. */
  runInputs: Record<string, unknown>;
```

- [ ] **Step 2.2** Append `OutputSchema` types at end of file:

```ts
export type OutputFieldType = "string" | "number" | "boolean" | "string[]" | "json" | "enum";

export interface OutputFieldSchema {
  type: OutputFieldType;
  description?: string;
  values?: readonly string[]; // when type === "enum"
}

export type OutputSchema = Record<string, OutputFieldSchema>;
```

- [ ] **Step 2.3** Re-export from core. In `packages/core/src/index.ts` extend the phase-handler re-exports to include `OutputSchema`, `OutputFieldSchema`, `OutputFieldType`.

---

### Task T3: PhaseDefinition.outputSchema

**Files:**
- Modify: `packages/flow-editor/src/phase-definition.ts`

- [ ] **Step 3.1** Add import at top:

```ts
import type { OutputSchema } from "@journeyman/core";
```

- [ ] **Step 3.2** Add field inside `PhaseDefinition` interface (after `executor` block):

```ts
  /** Declared shape of this phase's output — drives the editor picker. */
  outputSchema?: OutputSchema;
```

---

### Task T4: Converter — resolveInputs + validation

**Files:**
- Modify: `packages/orchestrator/src/flow-json/conductor-converter.ts`
- Create: `packages/orchestrator/src/flow-json/resolve-inputs.ts`
- Create: `packages/orchestrator/src/flow-json/reachability.ts`

- [ ] **Step 4.1** Create `resolve-inputs.ts`:

```ts
import type { FlowInputValue } from "@journeyman/core";

export function resolveInputs(
  inputs: Record<string, FlowInputValue> | undefined
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(inputs ?? {})) {
    if (v.kind === "literal") out[k] = v.value;
    else out[k] = "${" + v.ref + "}";
  }
  return out;
}

/** "analyze.output.summary" → { source: "analyze", field: "summary" } */
export function parseRef(ref: string): { source: string; field: string } | null {
  if (ref.startsWith("workflow.input.")) {
    return { source: "workflow.input", field: ref.slice("workflow.input.".length) };
  }
  const m = /^([^.]+)\.output\.(.+)$/.exec(ref);
  return m ? { source: m[1], field: m[2] } : null;
}
```

- [ ] **Step 4.2** Create `reachability.ts`:

```ts
import type { FlowGraph } from "@journeyman/core";

/** Returns the set of node ids that execute on EVERY path from start to `target`. */
export function dominators(graph: FlowGraph, target: string): Set<string> {
  const start = graph.nodes.find(n => n.type === "start")?.id;
  if (!start) return new Set();
  const allIds = new Set(graph.nodes.map(n => n.id));
  // Standard iterative dominator algorithm.
  const dom = new Map<string, Set<string>>();
  for (const id of allIds) dom.set(id, id === start ? new Set([start]) : new Set(allIds));
  const preds = new Map<string, string[]>();
  for (const id of allIds) preds.set(id, []);
  for (const e of graph.edges) preds.get(e.target)?.push(e.source);
  let changed = true;
  while (changed) {
    changed = false;
    for (const id of allIds) {
      if (id === start) continue;
      const p = preds.get(id) ?? [];
      if (p.length === 0) continue;
      const inter = p
        .map(x => dom.get(x) ?? new Set<string>())
        .reduce((a, b) => new Set([...a].filter(x => b.has(x))));
      inter.add(id);
      const prev = dom.get(id)!;
      if (prev.size !== inter.size || [...inter].some(x => !prev.has(x))) {
        dom.set(id, inter);
        changed = true;
      }
    }
  }
  return dom.get(target) ?? new Set();
}
```

- [ ] **Step 4.3** In `conductor-converter.ts`, add imports at top:

```ts
import { resolveInputs, parseRef } from "./resolve-inputs.ts";
import { dominators } from "./reachability.ts";
```

- [ ] **Step 4.4** In `emitPhase` (around lines 116-139), modify the `inputParameters` IIFE so wires merge AFTER config:

Replace the existing return block inside the IIFE with:

```ts
        return {
          ...(node.config ?? {}),
          ...resolveInputs(node.inputs),
          retry: node.retry ?? {},
          credentials: creds,
        };
```

- [ ] **Step 4.5** Apply same merge to `emitDoWhile` (line ~230) and `emitSubflow` (line ~258). Replace each `inputParameters: { ...(node.config ?? {}) }` with:

```ts
inputParameters: { ...(node.config ?? {}), ...resolveInputs(node.inputs) },
```

- [ ] **Step 4.6** Extend `validate()` (line ~57). After existing start/end checks, append:

```ts
    // Validate inputs / refs on every node.
    const nodeIds = new Set(this.nodes.map(n => n.id));
    const startNode = this.nodes.find(n => n.type === "start");
    const runInputDefs = ((startNode?.config as { runInputs?: Array<{ name: string }> } | undefined)?.runInputs ?? []);
    const runInputNames = new Set(runInputDefs.map(d => d.name));
    this.warnings = [];

    for (const node of this.nodes) {
      for (const [field, val] of Object.entries(node.inputs ?? {})) {
        if (val.kind !== "ref") continue;
        const parsed = parseRef(val.ref);
        if (!parsed) {
          throw new FlowValidationError(`Node '${node.id}' input '${field}' has unparseable ref '${val.ref}'`);
        }
        if (parsed.source === "workflow.input") {
          if (!runInputNames.has(parsed.field)) {
            throw new FlowValidationError(`Node '${node.id}' references undeclared run input '${parsed.field}'`);
          }
          continue;
        }
        if (!nodeIds.has(parsed.source)) {
          throw new FlowValidationError(`Node '${node.id}' references missing node '${parsed.source}'`);
        }
        const doms = dominators(this.graph, node.id);
        if (!doms.has(parsed.source)) {
          throw new FlowValidationError(
            `Node '${node.id}' references '${parsed.source}' which does not execute on every path to '${node.id}'`
          );
        }
        // Field-declared check: warning only — handled at API layer where outputSchemas live.
      }
    }
```

- [ ] **Step 4.7** Add to the converter context class fields (near top of context class, look around line 20-50):

```ts
  warnings: string[] = [];
  graph!: FlowGraph; // assign in constructor where nodes/edges already are
```

In the constructor, set `this.graph = graph;` alongside `this.nodes = ...; this.edges = ...`.

(If the constructor signature differs, mirror however `nodes`/`edges` are stored — read lines 17-55 first.)

---

### Task T5: Declare outputSchema on built-in phases

Each subtask is independent — dispatch in parallel.

**Files:**
- Modify: `packages/phases/src/ai/{analyze,plan,implement}.tsx`
- Modify: `packages/phases/src/repos/{checkout-repo,scan-repos,commit-push,create-workspace,cleanup-repos}.tsx`
- Modify: `packages/phases/src/tickets/{get-ticket,create-ticket,update-ticket,update-status,add-ticket-comment}.tsx`
- Modify: `packages/phases/src/notifications/notify.tsx`

For each phase definition object, add an `outputSchema` property. Pattern:

```ts
import type { OutputSchema } from "@journeyman/core";

const outputSchema: OutputSchema = {
  // …fields per below
};

export const xxxPhase: PhaseDefinition<XxxConfig> = {
  // …existing fields,
  outputSchema,
};
```

- [ ] **Step 5.1 (T5a · ai phases)** Add schemas:

`analyze.tsx`:
```ts
{ summary: { type: "string", description: "Plain-language change summary" },
  complexity: { type: "enum", values: ["low","medium","high"] as const },
  affectedFiles: { type: "string[]", description: "Files likely to change" } }
```

`plan.tsx`:
```ts
{ steps: { type: "json", description: "Ordered list of implementation steps" },
  estimatedMinutes: { type: "number" } }
```

`implement.tsx`:
```ts
{ filesChanged: { type: "string[]" },
  diffSummary: { type: "string" } }
```

- [ ] **Step 5.2 (T5b · repos phases)** Add schemas:

`checkout-repo.tsx`: `{ branch: { type: "string" }, commitSha: { type: "string" } }`

`scan-repos.tsx`: `{ files: { type: "string[]" }, fileCount: { type: "number" } }`

`commit-push.tsx`: `{ commitSha: { type: "string" }, pushed: { type: "boolean" } }`

`create-workspace.tsx`: `{ workspaceDir: { type: "string" } }`

`cleanup-repos.tsx`: `{ removed: { type: "boolean" } }`

- [ ] **Step 5.3 (T5c · tickets phases)** Add schemas:

`get-ticket.tsx`: `{ id: { type: "string" }, title: { type: "string" }, description: { type: "string" }, labels: { type: "string[]" }, status: { type: "string" } }`

`create-ticket.tsx`: `{ id: { type: "string" }, url: { type: "string" } }`

`update-ticket.tsx`: `{ updated: { type: "boolean" } }`

`update-status.tsx`: `{ status: { type: "string" } }`

`add-ticket-comment.tsx`: `{ commentId: { type: "string" } }`

- [ ] **Step 5.4 (T5d · notifications)** Add schema to `notify.tsx`:

```ts
{ delivered: { type: "boolean" }, channelId: { type: "string" } }
```

---

### Task T6: API — phase catalog + save validation

**Files:**
- Modify: `packages/api-server/src/routes/flows.ts`
- Create: `packages/api-server/src/routes/phases.ts`
- Modify: `packages/api-server/src/server.ts` (route registration)
- Modify: `packages/api-server/src/composition.ts` (if catalog deps wired here)

- [ ] **Step 6.1** Create `packages/api-server/src/routes/phases.ts`:

```ts
import { Router } from "express";
import { builtInPhases } from "@journeyman/phases";

export function makePhasesRouter(): Router {
  const r = Router();
  r.get("/phases", (_req, res) => {
    res.json({
      phases: builtInPhases.map(p => ({
        phaseType: p.phaseType,
        label: p.label,
        category: p.category,
        outputSchema: p.outputSchema ?? null,
      })),
    });
  });
  return r;
}
```

- [ ] **Step 6.2** Register the router in `packages/api-server/src/server.ts`. After existing `app.use(...)` lines for flows/runs, add:

```ts
import { makePhasesRouter } from "./routes/phases.ts";
// …
app.use("/api", makePhasesRouter());
```

(Match the existing prefix / mounting style — read existing `app.use` lines first.)

- [ ] **Step 6.3** In `packages/api-server/src/routes/flows.ts`, run validation on flow-version create/update. Locate the route that calls `flowStore.createVersion(...)` (around line 97) and the create-flow route (around line 53). Before persisting, invoke the converter's validate:

```ts
import { ConductorJsonConverter } from "@journeyman/orchestrator";
// …inside handler, before persistence call:
const converter = new ConductorJsonConverter();
try {
  converter.validate(body.definition as FlowGraph);
} catch (e: any) {
  return res.status(400).json({ error: "FlowValidationError", message: e.message });
}
```

(If `ConductorJsonConverter` already exposes `validate(graph)` standalone, use it. If validation is private to `toEngineJson`, expose a public `validateGraph(graph: FlowGraph): void` static/method in T4 and use it here.)

- [ ] **Step 6.4** Field-declared warning. Inside the same flows save handler, after validate, build `outputSchemas` map from `builtInPhases` and warn (log only — non-blocking) for refs to undeclared fields:

```ts
import { builtInPhases } from "@journeyman/phases";
import { parseRef } from "@journeyman/orchestrator/dist/flow-json/resolve-inputs.js";
const schemas = new Map(builtInPhases.map(p => [p.phaseType, p.outputSchema ?? {}]));
const warnings: string[] = [];
for (const node of (body.definition as FlowGraph).nodes) {
  for (const [field, v] of Object.entries(node.inputs ?? {})) {
    if (v.kind !== "ref") continue;
    const parsed = parseRef(v.ref);
    if (!parsed || parsed.source === "workflow.input") continue;
    const upstream = (body.definition as FlowGraph).nodes.find(n => n.id === parsed.source);
    if (!upstream?.phaseType) continue;
    const schema = schemas.get(upstream.phaseType) ?? {};
    if (!(parsed.field in schema)) warnings.push(`'${node.id}.${field}' uses undeclared field '${parsed.field}' on '${upstream.phaseType}'`);
  }
}
if (warnings.length) console.warn("[flow save warnings]", warnings);
```

(Adjust the `parseRef` import path to whatever the package exports — re-export it from `@journeyman/orchestrator`'s root `index.ts`.)

- [ ] **Step 6.5** Re-export `parseRef` from orchestrator. In `packages/orchestrator/src/index.ts` add:

```ts
export { parseRef, resolveInputs } from "./flow-json/resolve-inputs.ts";
```

---

### Task T7: Editor — value picker

**Files:**
- Create: `packages/flow-editor/src/properties-panel/ValuePicker.tsx`
- Create: `packages/flow-editor/src/properties-panel/use-upstream-sources.ts`
- Modify: `packages/flow-editor/src/properties-panel/ConfigTab.tsx`

- [ ] **Step 7.1** Create `use-upstream-sources.ts`:

```ts
import { useMemo } from "react";
import type { FlowGraph, OutputSchema } from "@journeyman/core";

export interface UpstreamSource {
  kind: "run-input" | "node";
  id: string;            // node id, or "" for run-input
  label: string;
  fields: { name: string; description?: string }[];
}

/** Reverse-walks graph from `nodeId`, returns source list filtered to dominators only. */
export function useUpstreamSources(
  graph: FlowGraph,
  nodeId: string,
  schemas: Record<string, OutputSchema | null>
): UpstreamSource[] {
  return useMemo(() => {
    const startNode = graph.nodes.find(n => n.type === "start");
    const runInputs = ((startNode?.config as { runInputs?: { name: string; description?: string }[] } | undefined)?.runInputs ?? []);
    // Dominator set (mirror algorithm of orchestrator/reachability.ts).
    const allIds = new Set(graph.nodes.map(n => n.id));
    const start = startNode?.id;
    const dom = new Map<string, Set<string>>();
    for (const id of allIds) dom.set(id, id === start ? new Set([start!]) : new Set(allIds));
    const preds = new Map<string, string[]>();
    for (const id of allIds) preds.set(id, []);
    for (const e of graph.edges) preds.get(e.target)?.push(e.source);
    let changed = true;
    while (changed) {
      changed = false;
      for (const id of allIds) {
        if (id === start) continue;
        const p = preds.get(id) ?? [];
        if (!p.length) continue;
        const inter = p.map(x => dom.get(x) ?? new Set<string>()).reduce((a, b) => new Set([...a].filter(x => b.has(x))));
        inter.add(id);
        const prev = dom.get(id)!;
        if (prev.size !== inter.size || [...inter].some(x => !prev.has(x))) { dom.set(id, inter); changed = true; }
      }
    }
    const upstream = [...(dom.get(nodeId) ?? new Set())].filter(id => id !== nodeId);

    const sources: UpstreamSource[] = [];
    if (runInputs.length) {
      sources.push({ kind: "run-input", id: "", label: "Run inputs", fields: runInputs.map(r => ({ name: r.name, description: r.description })) });
    }
    for (const id of upstream) {
      const n = graph.nodes.find(x => x.id === id);
      if (!n || n.type !== "phase" || !n.phaseType) continue;
      const schema = schemas[n.phaseType] ?? {};
      sources.push({
        kind: "node",
        id,
        label: n.displayName ?? n.phaseType,
        fields: Object.entries(schema).map(([name, s]) => ({ name, description: (s as { description?: string }).description })),
      });
    }
    return sources;
  }, [graph, nodeId, schemas]);
}
```

- [ ] **Step 7.2** Create `ValuePicker.tsx`:

```tsx
import { useState } from "react";
import type { UpstreamSource } from "./use-upstream-sources.ts";

interface Props {
  sources: UpstreamSource[];
  onPick: (ref: string) => void;
  onClose: () => void;
}

export function ValuePicker({ sources, onPick, onClose }: Props) {
  const [active, setActive] = useState<string | null>(sources[0]?.id ?? null);
  const [customMode, setCustomMode] = useState(false);
  const [custom, setCustom] = useState("");
  const cur = sources.find(s => s.id === active);

  const refFor = (s: UpstreamSource, field: string) =>
    s.kind === "run-input" ? `workflow.input.${field}` : `${s.id}.output.${field}`;

  return (
    <div className="value-picker">
      <div className="value-picker-cols">
        <ul className="vp-sources">
          {sources.map(s => (
            <li key={s.id || "_run"} className={s.id === active ? "active" : ""} onClick={() => { setActive(s.id); setCustomMode(false); }}>
              {s.label}
            </li>
          ))}
        </ul>
        <ul className="vp-fields">
          {cur?.fields.map(f => (
            <li key={f.name} onClick={() => onPick(refFor(cur, f.name))} title={f.description}>{f.name}</li>
          ))}
          {cur && (
            <li className="vp-custom" onClick={() => setCustomMode(true)}>+ custom field…</li>
          )}
        </ul>
      </div>
      {customMode && cur && (
        <div className="vp-custom-input">
          <input value={custom} onChange={e => setCustom(e.target.value)} placeholder="field path" />
          <button onClick={() => { if (custom) onPick(refFor(cur, custom)); }}>Use</button>
        </div>
      )}
      <button className="vp-close" onClick={onClose}>Close</button>
    </div>
  );
}
```

- [ ] **Step 7.3** Wire into `ConfigTab.tsx`. Add an `{x}` button next to each rendered field that opens `ValuePicker` in a popover. On pick, update `node.inputs[fieldName] = { kind: "ref", ref }`. (Read current ConfigTab to match its rendering pattern; if it uses `SchemaForm`, add the picker as a custom widget shell.)

The minimum integration: add a sibling icon button per field. On click, fetch the global graph from editor state, call `useUpstreamSources(graph, nodeId, schemas)`, render `ValuePicker`, and on `onPick` dispatch a state update writing to `node.inputs[fieldKey]`.

`schemas` comes from a new `usePhaseCatalog()` hook that fetches `/api/phases` once and memoizes.

- [ ] **Step 7.4** Create `packages/flow-editor/src/catalogs/use-phase-catalog.ts`:

```ts
import { useEffect, useState } from "react";
import type { OutputSchema } from "@journeyman/core";

export function usePhaseCatalog(): Record<string, OutputSchema | null> {
  const [m, setM] = useState<Record<string, OutputSchema | null>>({});
  useEffect(() => {
    fetch("/api/phases").then(r => r.json()).then((d: { phases: { phaseType: string; outputSchema: OutputSchema | null }[] }) => {
      setM(Object.fromEntries(d.phases.map(p => [p.phaseType, p.outputSchema])));
    }).catch(() => {});
  }, []);
  return m;
}
```

- [ ] **Step 7.5** Style the picker. Append to `packages/flow-editor/src/styles.css`:

```css
.value-picker { background: var(--panel-bg, #fff); border: 1px solid #ddd; padding: 8px; min-width: 360px; }
.value-picker-cols { display: grid; grid-template-columns: 140px 1fr; gap: 8px; }
.vp-sources, .vp-fields { list-style: none; padding: 0; margin: 0; max-height: 240px; overflow-y: auto; }
.vp-sources li, .vp-fields li { padding: 4px 6px; cursor: pointer; border-radius: 3px; }
.vp-sources li.active, .vp-sources li:hover, .vp-fields li:hover { background: #eef; }
.vp-custom { font-style: italic; color: #666; }
.vp-custom-input { display: flex; gap: 4px; margin-top: 6px; }
.vp-close { margin-top: 6px; }
```

---

### Task T8: Editor — start node Run inputs

**Files:**
- Modify: `packages/flow-editor/src/properties-panel/FlowSettingsView.tsx`

- [ ] **Step 8.1** Read existing FlowSettingsView to confirm it renders when start node is selected. If not, route start-node selection to it.

- [ ] **Step 8.2** Add a "Run inputs" section that edits `startNode.config.runInputs: RunInputDef[]`. Minimal table UI with name / type / description / required + add/remove rows.

```tsx
import type { RunInputDef } from "@journeyman/core";

interface Props { value: RunInputDef[]; onChange: (next: RunInputDef[]) => void; }

export function RunInputsEditor({ value, onChange }: Props) {
  const update = (i: number, patch: Partial<RunInputDef>) =>
    onChange(value.map((r, idx) => idx === i ? { ...r, ...patch } : r));
  const add = () => onChange([...value, { name: "", type: "string" }]);
  const remove = (i: number) => onChange(value.filter((_, idx) => idx !== i));
  return (
    <div className="run-inputs-editor">
      <h4>Run inputs</h4>
      <table>
        <thead><tr><th>Name</th><th>Type</th><th>Description</th><th>Required</th><th></th></tr></thead>
        <tbody>
          {value.map((r, i) => (
            <tr key={i}>
              <td><input value={r.name} onChange={e => update(i, { name: e.target.value })} /></td>
              <td>
                <select value={r.type} onChange={e => update(i, { type: e.target.value as RunInputDef["type"] })}>
                  <option value="string">string</option><option value="number">number</option>
                  <option value="boolean">boolean</option><option value="json">json</option>
                </select>
              </td>
              <td><input value={r.description ?? ""} onChange={e => update(i, { description: e.target.value })} /></td>
              <td><input type="checkbox" checked={!!r.required} onChange={e => update(i, { required: e.target.checked })} /></td>
              <td><button onClick={() => remove(i)}>×</button></td>
            </tr>
          ))}
        </tbody>
      </table>
      <button onClick={add}>+ Add input</button>
    </div>
  );
}
```

- [ ] **Step 8.3** Mount `RunInputsEditor` inside `FlowSettingsView` when the selected node is the start node. Read its current `config.runInputs ?? []` and write back via the existing node-update dispatcher.

---

### Task T9: Editor — picker in edge condition / loop / timer

**Files:**
- Modify: relevant edge/condition editor file under `packages/flow-editor/src/properties-panel/` (find via grep: condition-related component)

- [ ] **Step 9.1** `grep -rn "condition\|JSONLogic" packages/flow-editor/src/properties-panel/ packages/flow-editor/src/canvas/ | head -20` — locate the edge condition editor and loop-condition editor.

- [ ] **Step 9.2** In each location, add a `{x}` icon next to the value input. On click, render `ValuePicker` (same component) using the same `useUpstreamSources` hook with the source-side node id.

- [ ] **Step 9.3** When inserting into a JSONLogic input, emit `{ "var": "<ref>" }`. When inserting into a `${...}` Conductor expression input (loop/timer), emit the literal `${<ref>}` string.

Pseudo:

```ts
function insertRef(ref: string, surface: "jsonlogic" | "expr") {
  return surface === "jsonlogic" ? { var: ref } : "${" + ref + "}";
}
```

---

### Task T10: Typecheck

- [ ] **Step 10.1** Run: `npm run typecheck`
- [ ] **Step 10.2** Fix any type errors surfaced. Re-run until clean. Expected: zero errors across all packages.

---

## Spec coverage map

| Spec § | Task |
|---|---|
| §3 model M4 — two scopes | T1, T4 |
| §4 saved JSON shape (FlowInputValue) | T1 |
| §5 outputSchema co-located | T2, T3, T5 |
| §6 picker E1 | T7 |
| §6.1 run inputs declaration on start node | T1, T8 |
| §7 validation: target / reachability / declared-warning | T4, T6 |
| §8 runtime resolution (converter merges) | T4 |
| §8.1 PhaseContext.runInputs | T2 |
| §9 conditions/loops/timers reuse picker | T9 |
| §10 migration (additive) | implicit — no schema break |
