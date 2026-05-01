import { useState } from "react";
import type { FlowDefaults } from "@journeyman/core";

interface Props {
  defaults: FlowDefaults;
  onChange: (next: FlowDefaults) => void;
  readOnly?: boolean;
}

export function DefaultsSecretsSection({ defaults, onChange, readOnly }: Props) {
  const [open, setOpen] = useState(true);
  const bindings = defaults.secretBindings ?? {};

  const removeSlot = (slot: string) => {
    const next = { ...bindings };
    delete next[slot];
    onChange({ ...defaults, secretBindings: Object.keys(next).length ? next : undefined });
  };

  const addSlot = (name: string) => {
    if (!name) return;
    onChange({ ...defaults, secretBindings: { ...bindings, [name]: { mode: "auto" } } });
  };

  return (
    <div style={{ borderTop: "1px solid #2a2a3a", paddingTop: 8, marginTop: 8 }}>
      <button type="button" onClick={() => setOpen(o => !o)}
        style={{ background: "none", border: "none", color: "#ccc", cursor: "pointer", fontSize: 12, padding: 0, marginBottom: 6 }}>
        {open ? "▾" : "▸"} Default secret bindings
      </button>
      {open && (
        <div style={{ paddingLeft: 8 }}>
          {Object.entries(bindings).map(([slot]) => (
            <div key={slot} className="je-props__field" style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <code style={{ flex: 1, fontSize: 11 }}>{slot}</code>
              <span style={{ fontSize: 11, color: "#888" }}>auto</span>
              <button type="button" disabled={readOnly} onClick={() => removeSlot(slot)}
                style={{ background: "none", border: "1px solid #444", color: "#888", padding: "0 6px", borderRadius: 3, cursor: "pointer" }}>×</button>
            </div>
          ))}
          {!readOnly && (
            <SlotAdder onAdd={addSlot} />
          )}
        </div>
      )}
    </div>
  );
}

function SlotAdder({ onAdd }: { onAdd: (name: string) => void }) {
  const [draft, setDraft] = useState("");
  return (
    <div style={{ display: "flex", gap: 4, marginTop: 4 }}>
      <input
        type="text"
        value={draft}
        placeholder="SLOT_NAME"
        onChange={e => setDraft(e.target.value.toUpperCase().replace(/[^A-Z0-9_]/g, ""))}
        style={{ flex: 1, fontFamily: "ui-monospace, monospace", fontSize: 11, background: "#1f1f2c", border: "1px solid #444", color: "#ddd", padding: "3px 6px", borderRadius: 4 }}
      />
      <button type="button"
        onClick={() => { onAdd(draft); setDraft(""); }}
        disabled={!draft}
        style={{ background: "#2a2a3e", border: "1px solid #444", color: "#ddd", padding: "3px 8px", borderRadius: 4, cursor: "pointer", fontSize: 11 }}>
        + Add
      </button>
    </div>
  );
}
