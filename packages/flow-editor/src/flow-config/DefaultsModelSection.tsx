import { useState } from "react";
import type { WorkflowDefaults } from "@journeyman/core";
import { CodingModelSelect } from "../components/CodingModelSelect.tsx";

interface Props {
  defaults: WorkflowDefaults;
  onChange: (next: WorkflowDefaults) => void;
  readOnly?: boolean;
}

export function DefaultsModelSection({ defaults, onChange, readOnly }: Props) {
  const [open, setOpen] = useState(true);
  const codingProvider = defaults.executorConfig?.["coding-cli"]?.provider;

  const setDefaultModel = (modelId: string | undefined) => {
    if (modelId) {
      onChange({ ...defaults, defaultModel: modelId });
    } else {
      const { defaultModel: _drop, ...rest } = defaults;
      onChange(rest);
    }
  };

  return (
    <div style={{ borderTop: "1px solid rgb(var(--color-surface-raised) / 1)", paddingTop: 8, marginTop: 8 }}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        style={{ background: "none", border: "none", color: "rgb(var(--color-text) / 1)", cursor: "pointer", fontSize: 12, padding: 0, marginBottom: 6 }}
      >
        {open ? "▾" : "▸"} Default model
      </button>
      {open && (
        <div style={{ paddingLeft: 8 }}>
          {codingProvider ? (
            <div className="je-props__field" style={{ marginBottom: 8 }}>
              <label>Model</label>
              <CodingModelSelect
                provider={codingProvider}
                value={defaults.defaultModel}
                onChange={setDefaultModel}
                emptyLabel="Use system default"
                disabled={readOnly}
              />
            </div>
          ) : (
            <div className="je-props__field-help">
              Choose a default coding-cli provider above to enable model selection.
            </div>
          )}
          <div className="je-props__field-help">
            Applied to AI steps that don't set their own model. Each step can override per-node.
          </div>
        </div>
      )}
    </div>
  );
}
