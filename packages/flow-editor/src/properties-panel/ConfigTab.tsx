// packages/flow-editor/src/properties-panel/ConfigTab.tsx
import { useState } from "react";
import type { FlowDefaults, FlowGraph, FlowNode } from "@journeyman/core";
import type { McpCatalog } from "../types.ts";
import { usePhaseRegistry } from "../state/phase-registry-context.tsx";
import { ExecutorBlock } from "./ExecutorBlock.tsx";
import { SchemaForm } from "./SchemaForm.tsx";
import { defaultProviderFor } from "../executor-common-config.ts";
import { ValuePicker } from "./ValuePicker.tsx";
import { sanitizeRef } from "./sanitize-ref.ts";
import { useUpstreamSources } from "./use-upstream-sources.ts";
import { usePhaseCatalog } from "../catalogs/use-phase-catalog.ts";
import { InheritanceChip } from "./InheritanceChip.tsx";

export interface ConfigTabProps {
  flow: FlowGraph;
  node: FlowNode;
  onChange: (next: FlowNode) => void;
  readOnly?: boolean;
  mcpCatalog?: McpCatalog;
  flowDefaults?: FlowDefaults;
}

export function ConfigTab({ flow, node, onChange, readOnly, mcpCatalog, flowDefaults }: ConfigTabProps) {
  const registry = usePhaseRegistry();
  const definition = registry.get(node.phaseType);
  const config = (node.config ?? {}) as Record<string, unknown>;
  const executorConfig = node.executorConfig ?? {};

  const catalog = usePhaseCatalog();
  const sources = useUpstreamSources(flow, node.id, catalog);
  const [pickerFor, setPickerFor] = useState<string | null>(null);

  const handlePick = (fieldKey: string, ref: string) => {
    const clean = sanitizeRef(ref);
    const inputs = { ...((node.inputs ?? {}) as Record<string, unknown>) };
    inputs[fieldKey] = { kind: "ref", ref: clean };
    onChange({ ...node, inputs: inputs as FlowNode["inputs"] });
    setPickerFor(null);
  };

  const handleUnbind = (fieldKey: string) => {
    const inputs = { ...((node.inputs ?? {}) as Record<string, unknown>) };
    delete inputs[fieldKey];
    onChange({ ...node, inputs: inputs as FlowNode["inputs"] });
  };

  /** Append `${ref}` to the field's literal config value (template-string mode). */
  const handleInsert = (fieldKey: string, ref: string) => {
    const clean = sanitizeRef(ref);
    const cfg = { ...config };
    const existing = typeof cfg[fieldKey] === "string" ? (cfg[fieldKey] as string) : "";
    cfg[fieldKey] = existing + "${" + clean + "}";
    onChange({ ...node, config: cfg });
    setPickerFor(null);
  };

  const inputsMap = (node.inputs ?? {}) as Record<string, { kind: string; ref?: string; value?: unknown }>;
  const boundKeys = new Set(
    Object.entries(inputsMap)
      .filter(([, v]) => v?.kind === "ref")
      .map(([k]) => k),
  );

  // Fields declared in the catalog as bindable-only (no typed UI). Shown as a separate "Required bindings" section.
  const catalogEntry = node.phaseType ? catalog[node.phaseType] : undefined;
  const configFieldKeys = new Set(definition?.configFields ? Object.keys(definition.configFields) : []);
  const bindOnlyFields = Object.entries(catalogEntry?.inputFields ?? {}).filter(
    ([key, meta]) => (meta as { bindOnly?: boolean }).bindOnly === true && !configFieldKeys.has(key),
  ) as [string, { type: string; label?: string; required?: boolean; bindOnly?: boolean }][];

  const renderFieldBindControl = (key: string) => {
    if (readOnly) return null;
    const isBound = boundKeys.has(key);
    return (
      <button
        type="button"
        className={`je-props__bind-icon${isBound ? " je-props__bind-icon--bound" : ""}`}
        onClick={() => setPickerFor(pickerFor === key ? null : key)}
        title={isBound ? `bound to ${inputsMap[key]?.ref}` : "bind to upstream value"}
      >
        {`{x}`}
      </button>
    );
  };

  const renderBoundPill = (key: string) => {
    const ref = inputsMap[key]?.ref ?? "";
    return (
      <div className="je-props__bound-pill">
        <span className="je-props__bound-pill-icon" aria-hidden>↳</span>
        <code className="je-props__bound-pill-ref">{ref}</code>
        {!readOnly && (
          <button
            type="button"
            className="je-props__bound-pill-unbind"
            onClick={() => handleUnbind(key)}
            title="unbind"
          >×</button>
        )}
      </div>
    );
  };

  return (
    <div>
      <div className="je-props__field">
        <label>Phase type</label>
        <select
          value={node.phaseType ?? ""}
          disabled={readOnly}
          onChange={e => {
            const nextType = e.target.value;
            const nextDef = registry.get(nextType);
            const nextProvider = nextDef ? defaultProviderFor(nextDef.executor.kind) : undefined;
            onChange({
              ...node,
              phaseType: nextType,
              config: nextDef ? { ...(nextDef.defaultConfig as Record<string, unknown>) } : node.config,
              executorConfig: nextProvider ? { provider: nextProvider } : undefined,
            });
          }}
        >
          {registry.list().map(d => (
            <option key={d.phaseType} value={d.phaseType}>{d.label}</option>
          ))}
        </select>
      </div>

      <div className="je-props__field">
        <label>Display name</label>
        <input
          type="text"
          value={node.displayName ?? ""}
          disabled={readOnly}
          onChange={e => onChange({ ...node, displayName: e.target.value })}
        />
      </div>

      {definition && (
        <ExecutorBlock
          kind={definition.executor.kind}
          value={executorConfig}
          onChange={next => onChange({ ...node, executorConfig: next })}
          readOnly={readOnly}
          flowDefaults={flowDefaults}
        />
      )}

      {definition?.ConfigForm && (
        <definition.ConfigForm
          config={config as never}
          onChange={next => onChange({ ...node, config: next as Record<string, unknown> })}
          readOnly={readOnly}
          catalogs={{ mcp: mcpCatalog }}
        />
      )}

      {(definition?.configFields || bindOnlyFields.length > 0) && (
        <div style={{ position: "relative" }}>
          {definition?.configFields && (
            <SchemaForm
              config={config}
              fields={definition.configFields}
              schema={definition.configSchema}
              onChange={next => onChange({ ...node, config: next })}
              readOnly={readOnly}
              boundKeys={boundKeys}
              renderFieldBindControl={renderFieldBindControl}
              renderBoundPill={renderBoundPill}
            />
          )}
          {bindOnlyFields.length > 0 && (
            <div className="je-props__bind-only-section">
              <div className="je-props__bind-only-title">Required bindings</div>
              {bindOnlyFields.map(([key, meta]) => {
                const isBound = boundKeys.has(key);
                const isRequired = !!meta.required;
                const defaultInput = flowDefaults?.inputs?.[key];
                const nodeInput = inputsMap[key];
                const hasDefault = defaultInput !== undefined && defaultInput.kind !== "suppress";
                const inheritState = nodeInput
                  ? (hasDefault ? "override" : "local")
                  : (hasDefault ? "inherited" : "unset");
                return (
                  <div key={key} className="je-props__field">
                    <div className="je-props__field-label-row">
                      <label>
                        {meta.label ?? key}
                        {isRequired && <span className="je-props__required-mark">*</span>}
                      </label>
                      {inheritState === "inherited" && (
                        <InheritanceChip
                          kind="inherited"
                          inheritedValue={defaultInput?.kind === "ref" ? defaultInput.ref : (defaultInput as { value?: unknown } | undefined)?.value}
                        />
                      )}
                      {inheritState === "override"  && (
                        <InheritanceChip kind="override" onReset={() => handleUnbind(key)} />
                      )}
                      {renderFieldBindControl(key)}
                    </div>
                    {isBound ? renderBoundPill(key) : (
                      inheritState === "inherited" && defaultInput ? (
                        <div className="je-props__bound-pill" style={{ opacity: 0.6 }}>
                          <span className="je-props__bound-pill-icon" aria-hidden>↳</span>
                          <code className="je-props__bound-pill-ref">
                            {defaultInput.kind === "ref" ? defaultInput.ref : String((defaultInput as { value?: unknown }).value ?? "")}
                          </code>
                        </div>
                      ) : (
                        <div className="je-props__bind-only-empty">
                          {isRequired ? "Required — bind from upstream" : "Optional — not bound"}
                        </div>
                      )
                    )}
                  </div>
                );
              })}
            </div>
          )}
          {pickerFor && (
            <div className="je-props__picker-popover">
              <ValuePicker
                sources={sources}
                onPick={ref => handlePick(pickerFor, ref)}
                onInsert={ref => handleInsert(pickerFor, ref)}
                onClose={() => setPickerFor(null)}
              />
            </div>
          )}
        </div>
      )}

      {definition?.description && (
        <div className="je-props__phase-desc">{definition.description}</div>
      )}
    </div>
  );
}
