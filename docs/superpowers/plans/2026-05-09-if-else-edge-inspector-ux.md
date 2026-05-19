# If/Else Edge Inspector UX Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix three UX defects in the `if`/`gateway-xor` edge inspector — replace the unclear conditional/else radio with a fallback checkbox, surface custom-ai phase outputs in the condition dropdown via lazy fetch, and make dropdown labels human-readable using `displayName`.

**Architecture:** Surgical changes to three files in `packages/flow-editor/src/inspector/`. `condition-suggestions.ts` gets two display fields and an optional `extraSchemas` argument; `ConditionBuilder.tsx` renders the new labels; `EdgeInspector.tsx` swaps the radio for a checkbox and lazy-fetches custom-phase schemas on mount. No commits during implementation; final typecheck only; no unit tests.

**Tech Stack:** TypeScript, React, native `<select>`, fetch API, `@journeyman/core` types, `useOrgId` context.

**Spec:** [docs/superpowers/specs/2026-05-09-if-else-edge-inspector-ux-design.md](../specs/2026-05-09-if-else-edge-inspector-ux-design.md)

---

## File Structure

| File | Action | Responsibility |
|---|---|---|
| `packages/flow-editor/src/inspector/condition-suggestions.ts` | Modify | Extend `ConditionSuggestion` shape, compute `groupLabel` / `fieldLabel`, accept optional `extraSchemas` arg, export `collectUpstreamPhases`, add `customAiOutputSchemaFromJsonSchema` helper. |
| `packages/flow-editor/src/inspector/ConditionBuilder.tsx` | Modify | Render `optgroup` by `groupLabel`, options by `fieldLabel`. |
| `packages/flow-editor/src/inspector/EdgeInspector.tsx` | Modify | Replace Type radio with "Mark as fallback" checkbox; lazy-fetch custom-ai phase schemas on mount; pass `extraSchemas` into `buildConditionSuggestions`. |

---

## Task 1: Extend `ConditionSuggestion` and label computation

**Files:**
- Modify: `packages/flow-editor/src/inspector/condition-suggestions.ts`

This task extends the suggestion data shape with display-only fields and exports a JSON-Schema → `OutputSchema` converter for use in Task 3. The stored `varPath` (option `value`) stays unchanged for backwards compatibility.

- [ ] **Step 1: Update `ConditionSuggestion` interface and `buildConditionSuggestions` signature**

Replace the file's contents at `packages/flow-editor/src/inspector/condition-suggestions.ts` with:

```ts
import type { WorkflowGraph, OutputSchema, Shape, CustomAiPhase } from "@journeyman/core";
import { WORKFLOW_INPUT_SUGGESTIONS, resolveShape } from "@journeyman/core";

export interface ConditionSuggestion {
  /** Full var path used in JsonLogic, e.g. "phase1.output.score". */
  path: string;
  /** Stable group key — phase id, or "Workflow input". */
  group: string;
  /** Display label for the optgroup, e.g. "Analyze Repo · #abc123" or "Workflow input". */
  groupLabel: string;
  /** Display label for the option, e.g. "output.score (number)". */
  fieldLabel: string;
  /** Logical type of the leaf, when known. */
  type?: "string" | "number" | "boolean" | "object" | "array";
}

export interface CatalogLookup {
  outputSchemaFor(phaseType: string): OutputSchema | null;
}

/**
 * Build the autosuggest list for a condition LHS attached to an edge that
 * leaves the gateway node identified by `gatewayId`.
 *
 * Walks predecessors backward (transparently through gateway-xor / gateway-and
 * nodes) and emits one entry per leaf field of each reachable phase's
 * outputSchema, plus the static workflow.input.* entries.
 *
 * `extraSchemas` lets callers inject runtime-fetched schemas (e.g. per-instance
 * custom-ai phase outputs that the static registry doesn't know about). When a
 * phase id has both a static schema and an extra schema, the extra schema wins
 * only if the static schema is empty.
 */
export function buildConditionSuggestions(
  flow: WorkflowGraph,
  gatewayId: string,
  catalog: CatalogLookup,
  extraSchemas?: Map<string, OutputSchema>,
): ConditionSuggestion[] {
  const phaseIds = collectUpstreamPhases(flow, gatewayId);

  // Precompute display names per phase id and detect duplicates so we know
  // when to disambiguate with a short id suffix.
  const displayNameByPhase = new Map<string, string>();
  const displayNameCounts = new Map<string, number>();
  for (const phaseId of phaseIds) {
    const node = flow.nodes.find(n => n.id === phaseId);
    const name = node?.displayName?.trim() || node?.phaseType || phaseId;
    displayNameByPhase.set(phaseId, name);
    displayNameCounts.set(name, (displayNameCounts.get(name) ?? 0) + 1);
  }

  const out: ConditionSuggestion[] = [];

  for (const phaseId of phaseIds) {
    const node = flow.nodes.find(n => n.id === phaseId);
    if (!node?.phaseType) continue;
    const staticSchema = catalog.outputSchemaFor(node.phaseType);
    const extra = extraSchemas?.get(phaseId);
    const schema =
      extra && (!staticSchema || Object.keys(staticSchema).length === 0)
        ? extra
        : staticSchema;
    if (!schema) continue;

    const displayName = displayNameByPhase.get(phaseId) ?? phaseId;
    const ambiguous = (displayNameCounts.get(displayName) ?? 0) > 1
      || displayName === phaseId;
    const groupLabel = ambiguous
      ? `${displayName} · #${phaseId.slice(-6)}`
      : displayName;

    for (const leaf of flattenOutputSchema(schema)) {
      const typeSuffix = leaf.type ? ` (${leaf.type})` : "";
      out.push({
        path: `${phaseId}.output.${leaf.path}`,
        group: phaseId,
        groupLabel,
        fieldLabel: `output.${leaf.path}${typeSuffix}`,
        type: leaf.type,
      });
    }
  }

  for (const w of WORKFLOW_INPUT_SUGGESTIONS) {
    const typeSuffix = w.type ? ` (${w.type})` : "";
    out.push({
      path: w.path,
      group: "Workflow input",
      groupLabel: "Workflow input",
      fieldLabel: `${w.path}${typeSuffix}`,
      type: w.type,
    });
  }

  return out;
}

export function collectUpstreamPhases(flow: WorkflowGraph, gatewayId: string): string[] {
  const incoming = new Map<string, string[]>();
  for (const e of flow.edges) {
    const arr = incoming.get(e.target) ?? [];
    arr.push(e.source);
    incoming.set(e.target, arr);
  }

  const seen = new Set<string>();
  const phases: string[] = [];
  const stack = [...(incoming.get(gatewayId) ?? [])];
  while (stack.length) {
    const id = stack.pop()!;
    if (seen.has(id)) continue;
    seen.add(id);
    const node = flow.nodes.find(n => n.id === id);
    if (!node) continue;
    if (node.type === "phase") phases.push(id);
    for (const pred of incoming.get(id) ?? []) stack.push(pred);
  }
  return phases.reverse();
}

interface Leaf {
  path: string;
  type?: ConditionSuggestion["type"];
}

function flattenOutputSchema(schema: OutputSchema): Leaf[] {
  const leaves: Leaf[] = [];
  for (const [field, shape] of Object.entries(schema)) {
    leaves.push(...flattenShape(shape, field));
  }
  return leaves;
}

function flattenShape(shape: Shape, prefix: string): Leaf[] {
  const resolved = resolveShape(shape);
  if (resolved.type === "object") {
    const out: Leaf[] = [];
    for (const [k, sub] of Object.entries(resolved.fields)) {
      out.push(...flattenShape(sub, `${prefix}.${k}`));
    }
    if (out.length === 0) return [{ path: prefix, type: "object" }];
    return out;
  }
  if (resolved.type === "array") {
    return [{ path: prefix, type: "array" }];
  }
  if (resolved.type === "ref") {
    return [{ path: prefix }];
  }
  return [{ path: prefix, type: resolved.type }];
}

/**
 * Convert a `CustomAiPhase` (whose `outputSchema` is a JSON Schema fragment)
 * into the editor's `OutputSchema` shape. Mirrors the conversion in
 * packages/web/src/flow-editor-integration/useCustomPhasePaletteEntries.ts —
 * inlined here to keep flow-editor independent of the web package.
 */
export function customAiOutputSchemaFromJsonSchema(p: CustomAiPhase): OutputSchema {
  if (p.outputMode === "text") {
    return { result: { type: "string" } } as OutputSchema;
  }
  if (p.outputMode === "structured" && p.outputSchema) {
    const props = (p.outputSchema as { properties?: Record<string, { type?: Shape["type"]; description?: string }> }).properties ?? {};
    return Object.fromEntries(
      Object.entries(props).map(([k, v]) => [
        k,
        { type: (v?.type ?? "string"), ...(v?.description ? { description: v.description } : {}) },
      ]),
    ) as OutputSchema;
  }
  return {} as OutputSchema;
}
```

Note: this rewrites the file. Two functions are now exported (`collectUpstreamPhases`, `customAiOutputSchemaFromJsonSchema`) that were previously private or absent. The interface adds `groupLabel` and `fieldLabel`.

---

## Task 2: Update `ConditionBuilder` to render new labels

**Files:**
- Modify: `packages/flow-editor/src/inspector/ConditionBuilder.tsx:99-121`

- [ ] **Step 1: Replace the `RowEditor` grouping/render with `groupLabel` and `fieldLabel`**

Find this block (around lines 99-121):

```tsx
  const grouped = useMemo(() => {
    const g: Record<string, ConditionSuggestion[]> = {};
    for (const s of p.suggestions) (g[s.group] ??= []).push(s);
    return g;
  }, [p.suggestions]);

  const selected = p.suggestions.find(s => s.path === p.row.varPath);

  return (
    <div className="je-condition-row">
      <select
        value={p.row.varPath}
        onChange={(e) => p.onChange({ ...p.row, varPath: e.target.value })}
      >
        <option value="">— pick a value —</option>
        {Object.entries(grouped).map(([group, items]) => (
          <optgroup key={group} label={group}>
            {items.map(s => (
              <option key={s.path} value={s.path}>{s.path}</option>
            ))}
          </optgroup>
        ))}
      </select>
```

Replace with:

```tsx
  const grouped = useMemo(() => {
    // Preserve insertion order; key by stable `group` (phase id), label by `groupLabel`.
    const order: string[] = [];
    const labelByGroup = new Map<string, string>();
    const itemsByGroup = new Map<string, ConditionSuggestion[]>();
    for (const s of p.suggestions) {
      if (!itemsByGroup.has(s.group)) {
        order.push(s.group);
        labelByGroup.set(s.group, s.groupLabel);
        itemsByGroup.set(s.group, []);
      }
      itemsByGroup.get(s.group)!.push(s);
    }
    return { order, labelByGroup, itemsByGroup };
  }, [p.suggestions]);

  const selected = p.suggestions.find(s => s.path === p.row.varPath);

  return (
    <div className="je-condition-row">
      <select
        value={p.row.varPath}
        onChange={(e) => p.onChange({ ...p.row, varPath: e.target.value })}
      >
        <option value="">— pick a value —</option>
        {grouped.order.map(group => (
          <optgroup key={group} label={grouped.labelByGroup.get(group) ?? group}>
            {grouped.itemsByGroup.get(group)!.map(s => (
              <option key={s.path} value={s.path}>{s.fieldLabel}</option>
            ))}
          </optgroup>
        ))}
      </select>
```

The rest of `RowEditor` (op select, value input, remove button) is unchanged. Stored `varPath` values remain identical.

---

## Task 3: Replace radio with checkbox and lazy-fetch custom-phase schemas

**Files:**
- Modify: `packages/flow-editor/src/inspector/EdgeInspector.tsx`

This task does three things in one file:

1. Adds a `useEffect` that walks upstream phases, identifies `custom-ai` nodes with a `customPhaseId`, and fetches each instance's schema in parallel.
2. Passes the resulting `extraSchemas` map into `buildConditionSuggestions`.
3. Replaces the `<fieldset>` Type radio with a "Mark as fallback (else)" checkbox plus an inline duplicate-else warning. While custom-phase schemas are loading, a disabled placeholder option is appended to the condition dropdown via the suggestions list.

- [ ] **Step 1: Replace the file contents**

Replace `packages/flow-editor/src/inspector/EdgeInspector.tsx` with:

```tsx
import { useEffect, useMemo, useState } from "react";
import type { WorkflowEdge, WorkflowGraph, JsonLogicExpr, OutputSchema, CustomAiPhase } from "@journeyman/core";
import { ConditionBuilder } from "./ConditionBuilder.tsx";
import {
  buildConditionSuggestions,
  collectUpstreamPhases,
  customAiOutputSchemaFromJsonSchema,
} from "./condition-suggestions.ts";
import { usePhaseRegistry } from "../state/phase-registry-context.tsx";
import { useOrgId } from "../state/org-context.tsx";

interface Props {
  flow: WorkflowGraph;
  edge: WorkflowEdge;
  onChange: (next: WorkflowEdge) => void;
}

interface CustomPhaseFetchTarget {
  phaseId: string;       // workflow node id
  customPhaseId: string; // CustomAiPhase.id
}

export function EdgeInspector({ flow, edge, onChange }: Props) {
  const registry = usePhaseRegistry();
  const orgId = useOrgId();
  const catalog = useMemo(
    () => ({
      outputSchemaFor: (phaseType: string) => registry.get(phaseType)?.outputSchema ?? null,
    }),
    [registry],
  );

  const sourceNode = flow.nodes.find(n => n.id === edge.source);
  const isXor = sourceNode?.type === "gateway-xor" || sourceNode?.type === "if";

  // Identify upstream custom-ai phases that need their schema fetched at runtime.
  const customTargets = useMemo<CustomPhaseFetchTarget[]>(() => {
    if (!isXor) return [];
    const upstream = collectUpstreamPhases(flow, edge.source);
    const targets: CustomPhaseFetchTarget[] = [];
    for (const phaseId of upstream) {
      const node = flow.nodes.find(n => n.id === phaseId);
      if (!node) continue;
      const isCustom = node.phaseType === "custom-ai" || node.phaseType?.startsWith("custom-ai:");
      if (!isCustom) continue;
      const cfg = (node.config ?? {}) as { customPhaseId?: unknown };
      if (typeof cfg.customPhaseId === "string" && cfg.customPhaseId) {
        targets.push({ phaseId, customPhaseId: cfg.customPhaseId });
      }
    }
    return targets;
  }, [flow, edge.source, isXor]);

  // Stable cache key — re-runs only when the set of (phaseId, customPhaseId) actually changes.
  const targetsKey = customTargets.map(t => `${t.phaseId}:${t.customPhaseId}`).sort().join(",");

  const [extraSchemas, setExtraSchemas] = useState<Map<string, OutputSchema>>(new Map());
  const [loadingExtras, setLoadingExtras] = useState(false);
  const [extrasErrored, setExtrasErrored] = useState(false);

  useEffect(() => {
    if (!isXor || !orgId || customTargets.length === 0) {
      setExtraSchemas(new Map());
      setLoadingExtras(false);
      setExtrasErrored(false);
      return;
    }
    let alive = true;
    setLoadingExtras(true);
    setExtrasErrored(false);

    const fetches = customTargets.map(async (t): Promise<[string, OutputSchema | null]> => {
      try {
        let res = await fetch(
          `/api/orgs/${orgId}/users/me/custom-phases/${t.customPhaseId}`,
          { credentials: "include" },
        );
        if (!res.ok) {
          res = await fetch(
            `/api/orgs/${orgId}/custom-phases/${t.customPhaseId}`,
            { credentials: "include" },
          );
        }
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const phase = (await res.json()) as CustomAiPhase;
        return [t.phaseId, customAiOutputSchemaFromJsonSchema(phase)];
      } catch (err) {
        console.warn(`[EdgeInspector] failed to load custom phase ${t.customPhaseId}:`, err);
        return [t.phaseId, null];
      }
    });

    Promise.all(fetches).then(results => {
      if (!alive) return;
      const next = new Map<string, OutputSchema>();
      let anyError = false;
      for (const [phaseId, schema] of results) {
        if (schema) next.set(phaseId, schema);
        else anyError = true;
      }
      setExtraSchemas(next);
      setExtrasErrored(anyError);
      setLoadingExtras(false);
    });

    return () => { alive = false; };
    // targetsKey captures the meaningful change; orgId & isXor are also tracked.
  }, [targetsKey, orgId, isXor]);

  const suggestions = useMemo(() => {
    if (!isXor) return [];
    const base = buildConditionSuggestions(flow, edge.source, catalog, extraSchemas);
    if (loadingExtras) {
      base.unshift({
        path: "__loading__",
        group: "__status__",
        groupLabel: "Status",
        fieldLabel: "Loading custom phase outputs…",
      });
    } else if (extrasErrored) {
      base.unshift({
        path: "__error__",
        group: "__status__",
        groupLabel: "Status",
        fieldLabel: "(failed to load some custom-phase outputs)",
      });
    }
    return base;
  }, [flow, edge.source, catalog, extraSchemas, loadingExtras, extrasErrored, isXor]);

  if (!isXor) {
    return (
      <div className="je-edge-inspector">
        <div className="je-edge-inspector__hint">
          This edge type has no editable properties.
        </div>
      </div>
    );
  }

  const type = edge.type ?? "default";
  const isElse = type === "else";
  const isConditional = !isElse;

  // Detect duplicate else branches from the same gateway (warning only).
  const otherElseCount = flow.edges.filter(
    e => e.source === edge.source && e.id !== edge.id && e.type === "else",
  ).length;
  const showDuplicateElseWarning = isElse && otherElseCount > 0;

  const toggleElse = (next: boolean) => {
    if (next) {
      onChange({ ...edge, type: "else", condition: undefined, branchLabel: undefined });
    } else {
      onChange({ ...edge, type: "conditional" });
    }
  };

  return (
    <div className="je-edge-inspector">
      <div className="je-edge-inspector__header">
        Edge: {edge.source} → {edge.target}
      </div>

      <label className="je-edge-inspector__field">
        <span>Branch label</span>
        <input
          type="text"
          value={edge.branchLabel ?? ""}
          onChange={(e) => onChange({ ...edge, branchLabel: e.target.value })}
          disabled={isElse}
        />
      </label>

      <label className="je-edge-inspector__fallback">
        <input
          type="checkbox"
          checked={isElse}
          onChange={(e) => toggleElse(e.target.checked)}
        />
        <span>
          <strong>Mark as fallback (else)</strong>
          <br />
          <small>Taken when no other conditional branch from this gateway matches.</small>
        </span>
      </label>

      {showDuplicateElseWarning && (
        <div className="je-edge-inspector__warning">
          This gateway already has an else branch — only one is allowed at runtime.
        </div>
      )}

      {isConditional && (
        <div className="je-edge-inspector__condition">
          <div className="je-edge-inspector__condition-header">Condition</div>
          <ConditionBuilder
            value={edge.condition}
            suggestions={suggestions}
            onChange={(expr: JsonLogicExpr | undefined) => onChange({ ...edge, condition: expr })}
          />
        </div>
      )}

      {!edge.branchLabel && isConditional && (
        <div className="je-edge-inspector__error">Branch label required.</div>
      )}
    </div>
  );
}
```

Key changes vs. the prior file:
- Imports `useEffect`, `useState`, `useMemo` from React; `OutputSchema`, `CustomAiPhase` from core; `collectUpstreamPhases`, `customAiOutputSchemaFromJsonSchema` from `condition-suggestions.ts`; `useOrgId` from the existing org context.
- Drops `import { useMemo } from "react"` line replaced by combined import above.
- Computes `customTargets` from upstream phases and runs the parallel fetch in a `useEffect`.
- `suggestions` is now `useMemo`-ized and prepends a status row when loading or errored.
- Replaces the radio fieldset with a single checkbox + helper text.
- Adds an inline duplicate-else warning.
- `ConditionBuilder` is rendered only when the edge is conditional (it was already gated on `isConditional`, unchanged).

Note: the loading/error placeholder rows have `path: "__loading__"` / `"__error__"` — the user can technically pick them, but `rowToExpr` will produce `{ "==": [{ "var": "__loading__" }, ""] }`. This is acceptable for v0 because (a) the placeholder disappears once loading completes, and (b) the user has no semantic reason to pick it. If undesirable, a follow-up can mark them `disabled` via a custom dropdown component.

---

## Task 4: Final typecheck

**Files:** none (verification only)

- [ ] **Step 1: Run the workspace typecheck**

Run: `npm run typecheck`

Expected: clean exit (no errors). If errors surface in `condition-suggestions.ts`, `ConditionBuilder.tsx`, or `EdgeInspector.tsx`, fix them inline against the type contracts shown in earlier tasks; common likely issues:

- Missing import for `CustomAiPhase` or `OutputSchema` from `@journeyman/core` — add to the import list.
- `useOrgId()` returning `string | null` while fetch URLs expect `string` — the effect already short-circuits when `!orgId`, so no further change should be needed; if TypeScript narrows differently, hoist `orgId` into a local `const o = orgId` after the guard.
- `WORKFLOW_INPUT_SUGGESTIONS` entries not having a `type` field — already handled by the optional chain (`w.type ? \` (${w.type})\` : ""`).

Do not commit. The user runs commits themselves.

---

## Self-review

**Spec coverage:**

- Spec §1 (Type field → checkbox) → Task 3.
- Spec §2 (dropdown readability via `displayName`) → Tasks 1 + 2.
- Spec §3 (custom-phase lazy fetch) → Tasks 1 (helper export) + 3 (effect + suggestions injection).
- Spec "backwards compatibility" (varPath unchanged) → Tasks 1 + 2 preserve `path` as the option value.
- Spec "testing" (manual) → user-driven; not included as automated tests per instruction.

**Placeholder scan:** No TBDs, no "handle edge cases" without code, no "similar to Task N" elisions. Every code step shows the full code.

**Type consistency:** `ConditionSuggestion` shape is defined in Task 1 with `groupLabel`/`fieldLabel`; Task 2 reads exactly those fields; Task 3's status placeholders include both fields. `customAiOutputSchemaFromJsonSchema` exported in Task 1 is imported in Task 3 by the same name. `collectUpstreamPhases` exported in Task 1 is imported in Task 3 by the same name. `OutputSchema` and `CustomAiPhase` are core types, not redefined.
