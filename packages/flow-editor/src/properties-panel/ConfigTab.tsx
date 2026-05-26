// packages/flow-editor/src/properties-panel/ConfigTab.tsx
import { useState, useEffect, useMemo } from "react";
import type { WorkflowDefaults, WorkflowGraph, WorkflowNode } from "@journeyman/core";
import type { McpCatalog } from "../types.ts";
import { useStepRegistry } from "../state/step-registry-context.tsx";
import { ExecutorBlock } from "./ExecutorBlock.tsx";
import { CodingModelSelect } from "../components/CodingModelSelect.tsx";
import { SchemaForm } from "./SchemaForm.tsx";
import { defaultProviderFor } from "../executor-common-config.ts";
import { sanitizeRef } from "./sanitize-ref.ts";
import { MentionInput } from "./MentionInput.tsx";
import { toMentionFields } from "./mention-fields.ts";
import { parseTemplate, segmentsToTemplate, soleRefOf, type Segment } from "./mention-serialize.ts";
import { useUpstreamSources, collectCustomStepIds } from "./use-upstream-sources.ts";
import { useStepCatalog } from "../catalogs/use-step-catalog.ts";
import { useCustomStepDefs } from "../catalogs/use-custom-step-defs.ts";
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
  const registry = useStepRegistry();
  const definition = registry.get(node.stepType);
  const config = (node.config ?? {}) as Record<string, unknown>;
  const executorConfig = node.executorConfig ?? {};

  const catalog = useStepCatalog();
  const customStepDefs = useCustomStepDefs(collectCustomStepIds(flow));
  const sources = useUpstreamSources(flow, node.id, catalog, customStepDefs);
  const [pickerFor, setPickerFor] = useState<string | null>(null);
  const nodeWarningsByKey = useNodeWarningsByKey(node.id);

  // Strip stale keys that are no longer declared in the step definition.
  // Runs once per node selection or step type change, but only after the
  // async catalog has loaded — otherwise knownInputKeys would be empty and
  // every binding would be incorrectly treated as stale.
  useEffect(() => {
    if (node.stepType && !catalogEntry) return;

    const currentInputs = (node.inputs ?? {}) as Record<string, unknown>;
    const currentConfig = (node.config ?? {}) as Record<string, unknown>;

    // Only sweep inputs when the catalog declares at least one input field.
    // Steps like `custom-ai` have empty static inputFields (the real ones
    // live per-instance in the DB) — for those, leave node.inputs alone.
    const declaredInputFields = catalogEntry?.inputFields ?? {};
    const knownInputKeys = Object.keys(declaredInputFields).length > 0
      ? new Set(Object.keys(declaredInputFields))
      : null;
    const staleInputKeys = knownInputKeys
      ? Object.keys(currentInputs).filter(k => !knownInputKeys.has(k))
      : [];

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
  }, [node.id, node.stepType]);

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

  const inputsMap = (node.inputs ?? {}) as Record<string, { kind: string; ref?: string; value?: unknown }>;
  const boundKeys = new Set(
    Object.entries(inputsMap)
      .filter(([, v]) => v?.kind === "ref")
      .map(([k]) => k),
  );

  // Fields declared in the catalog as bindable-only (no typed UI). Shown as a separate "Required bindings" section.
  const catalogEntry = node.stepType ? catalog[node.stepType] : undefined;
  const configFieldKeys = new Set(definition?.configFields ? Object.keys(definition.configFields) : []);
  const bindOnlyFields = Object.entries(catalogEntry?.inputFields ?? {}).filter(
    ([key, meta]) => (meta as { bindOnly?: boolean }).bindOnly === true && !configFieldKeys.has(key),
  ) as [string, { label?: string; required?: boolean; bindOnly?: boolean }][];

  const mentionFields = useMemo(() => toMentionFields(sources), [sources]);
  const MENTION_WIDGETS = new Set(["text", "textarea", "code"]);

  /** Build the initial chip-editor segments for a field from its stored value. */
  const segmentsForField = (key: string): Segment[] => {
    const bound = inputsMap[key];
    if (bound?.kind === "ref" && bound.ref) return [{ kind: "ref", ref: bound.ref }];
    const cfgVal = config[key];
    if (typeof cfgVal === "string") return parseTemplate(cfgVal);
    return [];
  };

  /** Persist edited segments back to inputs/config per the serialization rules. */
  const commitSegments = (key: string, segs: Segment[]) => {
    const inputs = { ...((node.inputs ?? {}) as Record<string, unknown>) };
    const cfg = { ...config };
    const sole = soleRefOf(segs);
    const template = segmentsToTemplate(segs);
    if (sole) {
      inputs[key] = { kind: "ref", ref: sanitizeRef(sole) };
      delete cfg[key];
    } else if (template !== "") {
      delete inputs[key];
      cfg[key] = template;
    } else {
      delete inputs[key];
      delete cfg[key];
    }
    onChange({ ...node, inputs: inputs as WorkflowNode["inputs"], config: cfg });
  };

  const renderMentionField = (key: string, meta: { widget?: string }) => {
    if (!MENTION_WIDGETS.has(meta.widget ?? "text")) return null;
    return (
      <MentionInput
        value={segmentsForField(key)}
        fields={mentionFields}
        readOnly={readOnly}
        onChange={segs => commitSegments(key, segs)}
      />
    );
  };

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
        <label>Step type</label>
        <span className="je-props__readonly-value">
          {registry.get(node.stepType ?? "")?.label ?? node.stepType ?? "—"}
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

      {definition?.executor.kind === "coding-cli"
        && ["runCustomPrompt", "checkoutRepo"].includes(definition.executor.method) && (
        <div className="je-props__field">
          <label>Agent log level</label>
          <select
            value={(config.agentLogLevel as string | undefined) ?? "none"}
            disabled={readOnly}
            onChange={e => {
              const next = { ...config };
              if (e.target.value === "none") delete next.agentLogLevel;
              else next.agentLogLevel = e.target.value;
              onChange({ ...node, config: next });
            }}
          >
            <option value="none">None — no agent SDK logs</option>
            <option value="light">Light — only final result line</option>
            <option value="medium">Medium — result + tool calls</option>
            <option value="all">All — full transcript</option>
          </select>
          <div className="je-props__field-help">
            Streams Claude SDK activity to the run viewer as it runs. Higher levels store more data per run.
          </div>
        </div>
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
          inputs={node.inputs}
          onInputsChange={next => onChange({ ...node, inputs: next })}
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
              renderFieldInput={renderMentionField}
              warningsByKey={nodeWarningsByKey}
            />
          )}
          {bindOnlyFields.length > 0 && (
            <div className="je-props__bind-only-section">
              <div className="je-props__bind-only-title">Required bindings</div>
              {bindOnlyFields.map(([key, meta]) => {
                const isRequired = !!meta.required;
                const warning = nodeWarningsByKey.get(key);
                return (
                  <div key={key} className={`je-props__field${warning ? " je-props__field--invalid" : ""}`}>
                    <div className="je-props__field-label-row">
                      <label>
                        {meta.label ?? key}
                        {isRequired && <span className="je-props__required-mark">*</span>}
                      </label>
                    </div>
                    <MentionInput
                      value={segmentsForField(key)}
                      fields={mentionFields}
                      readOnly={readOnly}
                      placeholder={isRequired ? "Required — @ to bind from upstream" : "Optional — @ to bind"}
                      onChange={segs => commitSegments(key, segs)}
                    />
                    {warning && <div className="je-props__field-error-msg">{warning.message}</div>}
                  </div>
                );
              })}
            </div>
          )}
          {pickerFor && (
            <div className="je-props__picker-popover">
              <MentionInput
                value={inputsMap[pickerFor]?.ref ? [{ kind: "ref", ref: inputsMap[pickerFor]!.ref! }] : []}
                fields={mentionFields}
                readOnly={readOnly}
                placeholder="@ to bind from upstream"
                onChange={segs => {
                  const sole = soleRefOf(segs);
                  if (sole) handlePick(pickerFor, sole);
                  else handleUnbind(pickerFor);
                }}
              />
            </div>
          )}
        </div>
      )}

      {definition?.description && (
        <div className="je-props__step-desc">{definition.description}</div>
      )}
    </div>
  );
}
