// packages/flow-editor/src/properties-panel/trigger-human-panel.tsx
import type {
  TriggerHumanConfig,
  TriggerHumanFieldOverride,
  TriggerHumanFieldWidget,
  WorkflowGraph,
  WorkflowNode,
} from "@journeyman/core";

export interface TriggerHumanPanelProps {
  node: WorkflowNode;
  graph: WorkflowGraph;
  onPatchConfig: (patch: Partial<TriggerHumanConfig>) => void;
}

export function TriggerHumanPanel({ node, graph, onPatchConfig }: TriggerHumanPanelProps): JSX.Element {
  const cfg = (node.config ?? {}) as unknown as TriggerHumanConfig;
  const overrides: Record<string, TriggerHumanFieldOverride> = cfg.fieldOverrides ?? {};
  const inputs = graph.inputDefs ?? [];

  return (
    <div className="jm-properties-panel-section">
      <h3>Human form trigger</h3>

      <label>
        Form title
        <input
          type="text"
          value={cfg.formTitle ?? ""}
          onChange={(e) => onPatchConfig({ formTitle: e.target.value || undefined })}
        />
      </label>

      <h4>Field overrides</h4>
      {inputs.length === 0 ? (
        <p>No workflow inputs declared. Add inputs in the Inputs tab first.</p>
      ) : (
        inputs.map((inp) => {
          const o: TriggerHumanFieldOverride = overrides[inp.name] ?? {};
          return (
            <fieldset key={inp.name}>
              <legend>{inp.name} <em>({inp.type})</em></legend>
              <label>
                Label
                <input
                  type="text"
                  value={o.label ?? ""}
                  onChange={(e) => {
                    const next = { ...overrides, [inp.name]: { ...o, label: e.target.value || undefined } };
                    onPatchConfig({ fieldOverrides: next });
                  }}
                />
              </label>
              <label>
                Description
                <input
                  type="text"
                  value={o.description ?? ""}
                  onChange={(e) => {
                    const next = { ...overrides, [inp.name]: { ...o, description: e.target.value || undefined } };
                    onPatchConfig({ fieldOverrides: next });
                  }}
                />
              </label>
              <label>
                Widget
                <select
                  value={o.widget ?? ""}
                  onChange={(e) => {
                    const widget = (e.target.value || undefined) as TriggerHumanFieldWidget | undefined;
                    const next = { ...overrides, [inp.name]: { ...o, widget } };
                    onPatchConfig({ fieldOverrides: next });
                  }}
                >
                  <option value="">(default)</option>
                  <option value="text">text</option>
                  <option value="textarea">textarea</option>
                  <option value="number">number</option>
                  <option value="checkbox">checkbox</option>
                  <option value="select">select</option>
                </select>
              </label>
              {o.widget === "select" ? (
                <label>
                  Options (comma-separated)
                  <input
                    type="text"
                    value={(o.options ?? []).join(", ")}
                    onChange={(e) => {
                      const opts = e.target.value.split(",").map((s) => s.trim()).filter(Boolean);
                      const next = { ...overrides, [inp.name]: { ...o, options: opts.length ? opts : undefined } };
                      onPatchConfig({ fieldOverrides: next });
                    }}
                  />
                </label>
              ) : null}
            </fieldset>
          );
        })
      )}
    </div>
  );
}
