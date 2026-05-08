// packages/flow-editor/src/properties-panel/ConfigTab.tsx
import { useState, useEffect } from "react";
import type { WorkflowDefaults, WorkflowGraph, WorkflowNode } from "@journeyman/core";
import type { McpCatalog } from "../types.ts";
import { usePhaseRegistry } from "../state/phase-registry-context.tsx";
import { ExecutorBlock } from "./ExecutorBlock.tsx";
import { CodingModelSelect } from "../components/CodingModelSelect.tsx";
import { SchemaForm } from "./SchemaForm.tsx";
import { defaultProviderFor } from "../executor-common-config.ts";
import { ValuePicker } from "./ValuePicker.tsx";
import { sanitizeRef } from "./sanitize-ref.ts";
import { useUpstreamSources } from "./use-upstream-sources.ts";
import { usePhaseCatalog } from "../catalogs/use-phase-catalog.ts";
import { useNodeWarningsByKey } from "../state/validation-context.tsx";

export interface ConfigTabProps {
  flow: WorkflowGraph;
  node: WorkflowNode;
  onChange: (next: WorkflowNode) => void;
  readOnly?: boolean;
  mcpCatalog?: McpCatalog;
  flowDefaults?: WorkflowDefaults;
}

export function ConfigTab({ flow, node, onChange, readOnly, mcpCatalog, flowDefaults }: ConfigTabProps) {
  const registry = usePhaseRegistry();
  const definition = registry.get(node.phaseType);
  const config = (node.config ?? {}) as Record<string, unknown>;
  const executorConfig = node.executorConfig ?? {};

  const catalog = usePhaseCatalog();
  const sources = useUpstreamSources(flow, node.id, catalog);
  const [pickerFor, setPickerFor] = useState<string | null>(null);
  const nodeWarningsByKey = useNodeWarningsByKey(node.id);

  // Strip stale keys that are no longer declared in the phase definition.
  // Runs once per node selection or phase type change, but only after the
  // async catalog has loaded — otherwise knownInputKeys would be empty and
  // every binding would be incorrectly treated as stale.
  useEffect(() => {
    if (node.phaseType && !catalogEntry) return;

    const currentInputs = (node.inputs ?? {}) as Record<string, unknown>;
    const currentConfig = (node.config ?? {}) as Record<string, unknown>;

    const knownInputKeys = new Set(Object.keys(catalogEntry?.inputFields ?? {}));
    const staleInputKeys = Object.keys(currentInputs).filter(k => !knownInputKeys.has(k));

    const knownConfigKeys =
      definition?.configFields && Object.keys(definition.configFields).length > 0
        ? new Set(Object.keys(definition.configFields))
        : null;
    const staleConfigKeys = knownConfigKeys
      ? Object.keys(currentConfig).filter(k => !knownConfigKeys.has(k))
      : [];

    if (staleInputKeys.length === 0 && staleConfigKeys.length === 0) return;

    const cleanedInputs = { ...currentInputs };
    for (const k of staleInputKeys) delete cleanedInputs[k];

    const cleanedConfig = { ...currentConfig };
    for (const k of staleConfigKeys) delete cleanedConfig[k];

    onChange({ ...node, inputs: cleanedInputs as WorkflowNode["inputs"], config: cleanedConfig });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [node.id, node.phaseType]);

  const handlePick = (fieldKey: string, ref: string) => {
    const clean = sanitizeRef(ref);
    const inputs = { ...((node.inputs ?? {}) as Record<string, unknown>) };
    inputs[fieldKey] = { kind: "ref", ref: clean };
    onChange({ ...node, inputs: inputs as WorkflowNode["inputs"] });
    setPickerFor(null);
  };

  const handleUnbind = (fieldKey: string) => {
    const inputs = { ...((node.inputs ?? {}) as Record<string, unknown>) };
    delete inputs[fieldKey];
    onChange({ ...node, inputs: inputs as WorkflowNode["inputs"] });
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
  ) as [string, { label?: string; required?: boolean; bindOnly?: boolean }][];

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
        <span className="je-props__readonly-value">
          {registry.get(node.phaseType ?? "")?.label ?? node.phaseType ?? "—"}
        </span>
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

      {definition?.supportsModelSelection && (() => {
        const provider =
          executorConfig?.provider
          ?? flowDefaults?.executorConfig?.["coding-cli"]?.provider;
        const flowDefault = flowDefaults?.defaultModel;
        const emptyLabel = flowDefault
          ? `Use flow default (${flowDefault})`
          : "Use system default";
        return (
          <div className="je-props__field">
            <label>Model</label>
            <CodingModelSelect
              provider={provider}
              value={node.model ?? undefined}
              onChange={(modelId) => onChange({ ...node, model: modelId ?? null })}
              emptyLabel={emptyLabel}
              disabled={readOnly}
            />
            {!provider && (
              <div className="je-props__field-help">
                Set a coding-cli provider (above or in flow defaults) to enable model selection.
              </div>
            )}
          </div>
        );
      })()}

      {definition?.ConfigForm && (
        <definition.ConfigForm
          config={config as never}
          onChange={next => onChange({ ...node, config: next as Record<string, unknown> })}
          readOnly={readOnly}
          catalogs={{ mcp: mcpCatalog }}
          sources={sources}
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
              warningsByKey={nodeWarningsByKey}
            />
          )}
          {bindOnlyFields.length > 0 && (
            <div className="je-props__bind-only-section">
              <div className="je-props__bind-only-title">Required bindings</div>
              {bindOnlyFields.map(([key, meta]) => {
                const isBound = boundKeys.has(key);
                const isRequired = !!meta.required;
                const warning = nodeWarningsByKey.get(key);
                return (
                  <div key={key} className={`je-props__field${warning ? " je-props__field--invalid" : ""}`}>
                    <div className="je-props__field-label-row">
                      <label>
                        {meta.label ?? key}
                        {isRequired && <span className="je-props__required-mark">*</span>}
                      </label>
                      {renderFieldBindControl(key)}
                    </div>
                    {isBound ? renderBoundPill(key) : (
                      <div className="je-props__bind-only-empty">
                        {isRequired ? "Required — bind from upstream" : "Optional — not bound"}
                      </div>
                    )}
                    {warning && <div className="je-props__field-error-msg">{warning.message}</div>}
                  </div>
                );
              })}
            </div>
          )}
          {pickerFor && (
            <div className="je-props__picker-popover">
              <ValuePicker
                sources={sources}
                expected={catalogEntry?.inputFields?.[pickerFor]?.shape}
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
