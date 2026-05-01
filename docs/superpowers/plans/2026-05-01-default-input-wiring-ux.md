# Default Input Wiring UX Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the two bare text inputs in `DefaultsInputsSection` with a name combobox (grouped dropdown from phase catalog) and a `{x}` ValuePicker button (run inputs only), plus auto-suggest when the selected name matches a run input.

**Architecture:** New `usePhaseInputNames` hook derives grouped input names from the phase catalog (filtered by canvas or all). `FlowConfigPanel` calls `usePhaseCatalog()` and passes `flow` + `catalog` down. `DefaultsInputsSection` is rewritten to own the combobox state, picker state, and auto-suggest logic — no changes to `ValuePicker`, `useUpstreamSources`, or any core/orchestrator packages.

**Tech Stack:** React, TypeScript, `@journeyman/core` types, existing `ValuePicker` + `FieldInfo` components, existing CSS classes (`je-props__bound-pill`, `je-props__picker-popover`).

---

## File Map

| File | Action | Responsibility |
|---|---|---|
| `packages/flow-editor/src/hooks/use-phase-input-names.ts` | **Create** | Hook: derive grouped input names from catalog + scope |
| `packages/flow-editor/src/flow-config/FlowConfigPanel.tsx` | **Modify** | Add `usePhaseCatalog()`, pass `flow` + `catalog` to `DefaultsInputsSection` |
| `packages/flow-editor/src/flow-config/DefaultsInputsSection.tsx` | **Rewrite** | Combobox, scope toggle, `{x}` picker, auto-suggest |

---

## Task 1: `usePhaseInputNames` hook

**Files:**
- Create: `packages/flow-editor/src/hooks/use-phase-input-names.ts`

The hook scans `PhaseCatalogEntry` values, groups unique input names by `category`, and returns them sorted. For canvas scope it filters to phase types currently on the canvas.

- [ ] **Step 1: Create the hook file**

```typescript
// packages/flow-editor/src/hooks/use-phase-input-names.ts
import { useMemo } from "react";
import type { PhaseCatalogEntry } from "../catalogs/use-phase-catalog.ts";

export interface InputNameGroup {
  group: string;
  names: string[];
}

export function usePhaseInputNames(
  catalog: Record<string, PhaseCatalogEntry>,
  scope: "catalog" | "canvas",
  canvasPhaseTypes: string[],
): InputNameGroup[] {
  return useMemo(() => {
    const entries = Object.values(catalog);
    const scoped = scope === "canvas"
      ? entries.filter(e => canvasPhaseTypes.includes(e.phaseType))
      : entries;

    const byGroup = new Map<string, Set<string>>();
    for (const entry of scoped) {
      const names = Object.keys(entry.inputFields);
      if (!names.length) continue;
      if (!byGroup.has(entry.category)) byGroup.set(entry.category, new Set());
      for (const n of names) byGroup.get(entry.category)!.add(n);
    }

    return [...byGroup.entries()]
      .map(([group, nameSet]) => ({ group, names: [...nameSet].sort() }))
      .sort((a, b) => a.group.localeCompare(b.group));
  }, [catalog, scope, canvasPhaseTypes]);
}
```

- [ ] **Step 2: Verify the file compiles in isolation**

```bash
cd packages/flow-editor && npx tsc --noEmit --strict 2>&1 | grep use-phase-input-names || echo "clean"
```

Expected: `clean` (or no errors mentioning this file).

---

## Task 2: Update `FlowConfigPanel` to supply catalog and flow

**Files:**
- Modify: `packages/flow-editor/src/flow-config/FlowConfigPanel.tsx`

`FlowConfigPanel` already receives `flow: FlowGraph`. We add `usePhaseCatalog()` here so the catalog fetch is shared at panel level rather than per-row. Pass both `flow` and `catalog` to `DefaultsInputsSection`.

- [ ] **Step 1: Update `FlowConfigPanel.tsx`**

Replace the entire file with:

```tsx
import type { FlowDefaults, FlowGraph } from "@journeyman/core";
import { X } from "lucide-react";
import { DefaultsRetrySection } from "./DefaultsRetrySection.tsx";
import { DefaultsExecutorSection } from "./DefaultsExecutorSection.tsx";
import { DefaultsSecretsSection } from "./DefaultsSecretsSection.tsx";
import { DefaultsInputsSection } from "./DefaultsInputsSection.tsx";
import { usePhaseCatalog } from "../catalogs/use-phase-catalog.ts";

export interface FlowConfigPanelProps {
  flow: FlowGraph;
  onChange: (next: FlowGraph) => void;
  onClose: () => void;
  readOnly?: boolean;
}

export function FlowConfigPanel({ flow, onChange, onClose, readOnly }: FlowConfigPanelProps) {
  const defaults = flow.defaults ?? {};
  const catalog = usePhaseCatalog();
  const updateDefaults = (next: FlowDefaults) =>
    onChange({ ...flow, defaults: Object.keys(next).length ? next : undefined });

  return (
    <aside className="je-editor__props" style={{ borderLeft: "1px solid #2a2a3a" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
        <div className="je-props__title" style={{ margin: 0 }}>Flow Defaults</div>
        <button type="button" onClick={onClose}
          style={{ background: "none", border: "none", color: "#888", cursor: "pointer", padding: 4 }}>
          <X size={14} aria-hidden />
        </button>
      </div>
      <div style={{ fontSize: 11, color: "#888", marginBottom: 12 }}>
        Values set here are inherited by all phase nodes. Each node can override individual fields.
      </div>

      <DefaultsExecutorSection defaults={defaults} onChange={updateDefaults} readOnly={readOnly} />
      <DefaultsRetrySection    defaults={defaults} onChange={updateDefaults} readOnly={readOnly} />
      <DefaultsSecretsSection  defaults={defaults} onChange={updateDefaults} readOnly={readOnly} />
      <DefaultsInputsSection
        defaults={defaults}
        onChange={updateDefaults}
        flow={flow}
        catalog={catalog}
        readOnly={readOnly}
      />
    </aside>
  );
}
```

---

## Task 3: Rewrite `DefaultsInputsSection`

**Files:**
- Modify: `packages/flow-editor/src/flow-config/DefaultsInputsSection.tsx`

This is the main rewrite. Key pieces:
- `nameScope` state (`"catalog" | "canvas"`) for the scope toggle checkbox.
- `dropdownOpenForKey` state — which row's name dropdown is open.
- `pickerOpenForKey` state — which row's ValuePicker is open.
- `runInputSource` — synthetic `UpstreamSource` built from the start node's `runInputs`, passed to `ValuePicker`.
- Auto-suggest runs on dropdown pick (combined with rename into one `onChange` call) and on name input `onBlur`.

- [ ] **Step 1: Replace `DefaultsInputsSection.tsx`**

```tsx
import { useMemo, useState } from "react";
import type { FlowDefaults, FlowGraph, FlowInputValue } from "@journeyman/core";
import { ValuePicker } from "../properties-panel/ValuePicker.tsx";
import { FieldInfo } from "../properties-panel/field-info.tsx";
import { sanitizeRef } from "../properties-panel/sanitize-ref.ts";
import { usePhaseInputNames } from "../hooks/use-phase-input-names.ts";
import type { PhaseCatalogEntry } from "../catalogs/use-phase-catalog.ts";
import type { UpstreamSource } from "../properties-panel/use-upstream-sources.ts";

interface Props {
  defaults: FlowDefaults;
  onChange: (next: FlowDefaults) => void;
  flow: FlowGraph;
  catalog: Record<string, PhaseCatalogEntry>;
  readOnly?: boolean;
}

export function DefaultsInputsSection({ defaults, onChange, flow, catalog, readOnly }: Props) {
  const [open, setOpen]                         = useState(true);
  const [nameScope, setNameScope]               = useState<"catalog" | "canvas">("catalog");
  const [dropdownOpenForKey, setDropdownOpenForKey] = useState<string | null>(null);
  const [pickerOpenForKey, setPickerOpenForKey] = useState<string | null>(null);

  const inputs: Record<string, FlowInputValue> = defaults.inputs ?? {};

  // Run inputs from the start node's config
  const startNode = flow.nodes.find(n => n.type === "start");
  const runInputDefs: { name: string }[] =
    ((startNode?.config as { runInputs?: { name: string }[] } | undefined)?.runInputs ?? []);
  const runInputNames = useMemo(() => runInputDefs.map(r => r.name), [runInputDefs]);

  // Canvas phase types for scope filter
  const canvasPhaseTypes = useMemo(
    () => flow.nodes
      .filter(n => n.type === "phase" && n.phaseType)
      .map(n => n.phaseType!),
    [flow.nodes],
  );

  const nameGroups = usePhaseInputNames(catalog, nameScope, canvasPhaseTypes);

  // Synthetic ValuePicker source: run inputs only
  const runInputSource: UpstreamSource = useMemo(() => ({
    kind: "run-input",
    id: "",
    label: "Run inputs",
    groups: [{
      title: "Run inputs",
      scope: "run-input",
      fields: runInputDefs.map(r => ({ name: r.name, scope: "run-input" as const })),
    }],
  }), [runInputDefs]);

  // Helpers
  const setRef = (key: string, ref: string) => {
    const clean = sanitizeRef(ref);
    onChange({ ...defaults, inputs: { ...inputs, [key]: { kind: "ref", ref: clean } } });
  };

  const removeKey = (key: string) => {
    const next = { ...inputs };
    delete next[key];
    onChange({ ...defaults, inputs: Object.keys(next).length ? next : undefined });
  };

  const renameKey = (oldKey: string, newKey: string) => {
    if (oldKey === newKey) return;
    const next: Record<string, FlowInputValue> = {};
    for (const [k, v] of Object.entries(inputs)) next[k === oldKey ? newKey : k] = v;
    onChange({ ...defaults, inputs: next });
  };

  const addRow = () =>
    onChange({ ...defaults, inputs: { ...inputs, "": { kind: "ref", ref: "" } } });

  // Auto-suggest on blur: if the name field now matches a run input and ref is empty, fill it
  const handleNameBlur = (key: string) => {
    const entry = inputs[key];
    const currentRef = entry?.kind === "ref" ? entry.ref : "";
    if (!currentRef && runInputNames.includes(key)) {
      setRef(key, `workflow.input.${key}`);
    }
  };

  // Dropdown pick: rename + auto-suggest in one onChange to avoid stale-closure race
  const handleDropdownPick = (oldKey: string, newName: string) => {
    const existingEntry = inputs[oldKey];
    const existingRef = existingEntry?.kind === "ref" ? existingEntry.ref : "";
    const newRef: FlowInputValue = (!existingRef && runInputNames.includes(newName))
      ? { kind: "ref", ref: `workflow.input.${newName}` }
      : (existingEntry ?? { kind: "ref", ref: "" });

    const next: Record<string, FlowInputValue> = {};
    for (const [k, v] of Object.entries(inputs)) {
      next[k === oldKey ? newName : k] = k === oldKey ? newRef : v;
    }
    onChange({ ...defaults, inputs: next });
    setDropdownOpenForKey(null);
  };

  return (
    <div style={{ borderTop: "1px solid #2a2a3a", paddingTop: 8, marginTop: 8 }}>
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        style={{ background: "none", border: "none", color: "#ccc", cursor: "pointer", fontSize: 12, padding: 0, marginBottom: 6 }}
      >
        {open ? "▾" : "▸"} Default input wiring
      </button>

      {open && (
        <div style={{ paddingLeft: 8 }}>
          <div style={{ fontSize: 11, color: "#888", marginBottom: 8 }}>
            Common inputs (e.g. <code>dirPath</code>, <code>targetDir</code>) wired here apply to all
            phases that don't set them explicitly.
          </div>

          {/* Scope toggle */}
          <div style={{ display: "flex", alignItems: "center", gap: 4, marginBottom: 8, fontSize: 11, color: "#aaa" }}>
            <label style={{ display: "flex", alignItems: "center", gap: 4, cursor: "pointer", margin: 0 }}>
              <input
                type="checkbox"
                checked={nameScope === "canvas"}
                onChange={e => setNameScope(e.target.checked ? "canvas" : "catalog")}
              />
              Canvas phases only
            </label>
            <FieldInfo text="When checked, the name dropdown only shows inputs used by phases currently on this canvas. Uncheck to see names from all known phase types." />
          </div>

          {/* Rows */}
          {Object.entries(inputs).map(([k, v]) => {
            const ref = v.kind === "ref" ? v.ref : "";
            const isDropOpen   = dropdownOpenForKey === k;
            const isPickerOpen = pickerOpenForKey === k;

            return (
              <div key={k} style={{ position: "relative", marginBottom: 4 }}>
                <div style={{ display: "flex", gap: 4, alignItems: "center" }}>

                  {/* Name combobox */}
                  <div style={{ flex: 1, display: "flex", background: "#1f1f2c", border: "1px solid #444", borderRadius: 4, overflow: "hidden" }}>
                    <input
                      type="text"
                      value={k}
                      disabled={readOnly}
                      placeholder="inputName"
                      style={{ flex: 1, background: "transparent", border: "none", color: "#ddd", padding: "3px 6px", fontSize: 11, fontFamily: "ui-monospace, monospace", outline: "none" }}
                      onChange={e => renameKey(k, e.target.value)}
                      onBlur={() => handleNameBlur(k)}
                    />
                    {!readOnly && (
                      <button
                        type="button"
                        style={{ background: "#252535", border: "none", borderLeft: "1px solid #444", color: "#888", padding: "0 6px", cursor: "pointer", fontSize: 10 }}
                        onClick={() => setDropdownOpenForKey(isDropOpen ? null : k)}
                      >▾</button>
                    )}
                  </div>

                  {/* Ref field */}
                  {ref ? (
                    <div className="je-props__bound-pill" style={{ flex: 2 }}>
                      <span className="je-props__bound-pill-icon" aria-hidden>↳</span>
                      <code className="je-props__bound-pill-ref">{ref}</code>
                      {!readOnly && (
                        <button
                          type="button"
                          className="je-props__bound-pill-unbind"
                          onClick={() => setRef(k, "")}
                          title="unbind"
                        >×</button>
                      )}
                    </div>
                  ) : (
                    <button
                      type="button"
                      disabled={readOnly}
                      onClick={() => setPickerOpenForKey(isPickerOpen ? null : k)}
                      style={{ flex: 2, background: "#2a2a3e", border: "1px solid #444", color: "#ddd", padding: "4px 8px", borderRadius: 4, fontSize: 11, cursor: "pointer", textAlign: "left" }}
                    >{"{x} Pick value…"}</button>
                  )}

                  {/* Remove row */}
                  <button
                    type="button"
                    disabled={readOnly}
                    onClick={() => removeKey(k)}
                    style={{ background: "transparent", border: "1px solid #444", color: "#888", padding: "0 8px", borderRadius: 4, cursor: "pointer" }}
                  >×</button>
                </div>

                {/* Name dropdown */}
                {isDropOpen && (
                  <div style={{ position: "absolute", top: "100%", left: 0, width: "45%", background: "#1f1f2c", border: "1px solid #555", borderRadius: 4, zIndex: 20, maxHeight: 180, overflowY: "auto", fontSize: 11 }}>
                    {nameGroups.map(g => (
                      <div key={g.group}>
                        <div style={{ padding: "3px 8px", color: "#888", fontSize: 10 }}>{g.group}</div>
                        {g.names.map(n => (
                          <div
                            key={n}
                            style={{ padding: "3px 10px", color: k === n ? "#a78bfa" : "#ccc", background: k === n ? "#2a2a4a" : "transparent", cursor: "pointer" }}
                            onMouseDown={() => handleDropdownPick(k, n)}
                          >{n}</div>
                        ))}
                      </div>
                    ))}
                    <div
                      style={{ borderTop: "1px solid #333", padding: "3px 10px", color: "#666", fontStyle: "italic", cursor: "pointer", fontSize: 10 }}
                      onMouseDown={() => setDropdownOpenForKey(null)}
                    >+ custom name…</div>
                  </div>
                )}

                {/* ValuePicker */}
                {isPickerOpen && (
                  <div className="je-props__picker-popover">
                    <ValuePicker
                      sources={[runInputSource]}
                      onPick={ref => { setRef(k, ref); setPickerOpenForKey(null); }}
                      onClose={() => setPickerOpenForKey(null)}
                    />
                  </div>
                )}
              </div>
            );
          })}

          {!readOnly && (
            <button
              type="button"
              onClick={addRow}
              style={{ marginTop: 4, background: "#2a2a3e", border: "1px solid #444", color: "#ddd", padding: "3px 8px", borderRadius: 4, fontSize: 11, cursor: "pointer" }}
            >+ Add input default</button>
          )}
        </div>
      )}
    </div>
  );
}
```

---

## Task 4: Typecheck

- [ ] **Step 1: Run typecheck across all packages**

```bash
npm run typecheck
```

Expected: exit 0, no errors. If there are errors, fix them before marking this task complete.

Common issues to watch for:
- `UpstreamSource.groups[n].fields[n].scope` — must be `"run-input"` (not a plain string). The `as const` on the field literal handles this.
- `startNode.config` cast — the config is `unknown` on `FlowNode`; the explicit cast `as { runInputs?: { name: string }[] } | undefined` is intentional and correct.
- `PhaseCatalogEntry` import path — it is in `../catalogs/use-phase-catalog.ts` relative to `flow-config/`.
