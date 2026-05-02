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
  const [open, setOpen]                             = useState(true);
  const [nameScope, setNameScope]                   = useState<"catalog" | "canvas">("catalog");
  const [dropdownOpenForKey, setDropdownOpenForKey] = useState<string | null>(null);
  const [pickerOpenForKey, setPickerOpenForKey]     = useState<string | null>(null);

  const inputs: Record<string, FlowInputValue> = defaults.inputs ?? {};

  const startNode = flow.nodes.find(n => n.type === "start");
  const runInputDefs: { name: string }[] =
    ((startNode?.config as { runInputs?: { name: string }[] } | undefined)?.runInputs ?? []);
  const runInputNames = useMemo(() => runInputDefs.map(r => r.name), [runInputDefs]);

  const canvasPhaseTypes = useMemo(
    () => flow.nodes.filter(n => n.type === "phase" && n.phaseType).map(n => n.phaseType!),
    [flow.nodes],
  );

  const nameGroups = usePhaseInputNames(catalog, nameScope, canvasPhaseTypes);

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

  const handleNameBlur = (key: string) => {
    const entry = inputs[key];
    const currentRef = entry?.kind === "ref" ? entry.ref : "";
    if (!currentRef && runInputNames.includes(key)) {
      setRef(key, `workflow.input.${key}`);
    }
  };

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
            Common inputs (e.g. <code>repoDir</code>, <code>workspaceDir</code>) wired here apply to all
            phases that don't set them explicitly.
          </div>

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

          {Object.entries(inputs).map(([k, v]) => {
            const ref = v.kind === "ref" ? v.ref : "";
            const isDropOpen   = dropdownOpenForKey === k;
            const isPickerOpen = pickerOpenForKey === k;

            return (
              <div key={k} style={{ position: "relative", marginBottom: 4 }}>
                <div style={{ display: "flex", gap: 4, alignItems: "center" }}>

                  <div style={{ flex: 1, minWidth: 0, display: "flex", background: "#1f1f2c", border: "1px solid #444", borderRadius: 4, overflow: "hidden" }}>
                    <input
                      type="text"
                      value={k}
                      disabled={readOnly}
                      placeholder="inputName"
                      style={{ flex: 1, minWidth: 0, background: "transparent", border: "none", color: "#ddd", padding: "3px 6px", fontSize: 11, fontFamily: "ui-monospace, monospace", outline: "none" }}
                      onChange={e => renameKey(k, e.target.value)}
                      onBlur={() => handleNameBlur(k)}
                    />
                    {!readOnly && (
                      <button
                        type="button"
                        title="Pick known input name"
                        style={{ flexShrink: 0, background: "#3a3a52", border: "none", borderLeft: "1px solid #555", color: "#ddd", padding: "0 10px", cursor: "pointer", fontSize: 12, lineHeight: 1 }}
                        onClick={() => setDropdownOpenForKey(isDropOpen ? null : k)}
                      >▾</button>
                    )}
                  </div>

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

                  <button
                    type="button"
                    disabled={readOnly}
                    onClick={() => removeKey(k)}
                    style={{ background: "transparent", border: "1px solid #444", color: "#888", padding: "0 8px", borderRadius: 4, cursor: "pointer" }}
                  >×</button>
                </div>

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
