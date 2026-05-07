// packages/flow-editor/src/properties-panel/ControlNodeConfigTab.tsx
//
// T9: ValuePicker reuse for loop / timer expression surfaces.
//
// Conductor expression surfaces (loopCondition, until, duration) accept
// the literal string `${ref}`. JSONLogic surfaces (edge condition) wrap as
// `{ var: ref }`.
//
// TODO(T9): Add an Inspector / edge-properties surface so that
// FlowEdge.condition (JSONLogic) can be edited with the {x} ValuePicker
// button. Today, edges are not selectable in the PropertiesPanel — they
// only render via ConditionalEdge.tsx with a static branch label. Once an
// edge inspector exists, plug ValuePicker in there using
// `surface = "jsonlogic"` and merge the picked `{ var: ref }` into the
// existing JSONLogic value (or replace if empty).
import { useState } from "react";
import type { FlowGraph, FlowNode } from "@journeyman/core";
import { ValuePicker } from "./ValuePicker.tsx";
import { useUpstreamSources } from "./use-upstream-sources.ts";
import { usePhaseCatalog } from "../catalogs/use-phase-catalog.ts";

interface Props {
  flow: FlowGraph;
  node: FlowNode;
  onChange: (next: FlowNode) => void;
  readOnly?: boolean;
}

export function insertRef(ref: string, surface: "jsonlogic" | "expr"): unknown {
  return surface === "jsonlogic" ? { var: ref } : "${" + ref + "}";
}

interface ExprFieldProps {
  label: string;
  value: string;
  onChange: (next: string) => void;
  readOnly?: boolean;
  sources: ReturnType<typeof useUpstreamSources>;
}

function ExprField({ label, value, onChange, readOnly, sources }: ExprFieldProps) {
  const [showPicker, setShowPicker] = useState(false);
  return (
    <div className="je-field">
      <label className="je-field__label">{label}</label>
      <div className="je-field__row" style={{ display: "flex", gap: 4, position: "relative" }}>
        <input
          type="text"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          disabled={readOnly}
          style={{ flex: 1 }}
        />
        <button
          type="button"
          title="Insert reference"
          onClick={() => setShowPicker(true)}
          disabled={readOnly}
        >
          {"{x}"}
        </button>
        {showPicker && (
          <div style={{ position: "absolute", top: "100%", right: 0, zIndex: 10 }}>
            <ValuePicker
              sources={sources}
              onPick={(ref) => {
                const literal = insertRef(ref, "expr") as string;
                // Append at end. (Cursor-aware insertion would require a ref
                // to the input element; append is sufficient for v0.)
                onChange((value ?? "") + literal);
                setShowPicker(false);
              }}
              onClose={() => setShowPicker(false)}
            />
          </div>
        )}
      </div>
    </div>
  );
}

export function ControlNodeConfigTab({ flow, node, onChange, readOnly }: Props) {
  const catalog = usePhaseCatalog();
  const sources = useUpstreamSources(flow, node.id, catalog);
  const cfg = (node.config ?? {}) as Record<string, unknown>;

  const setCfg = (patch: Record<string, unknown>) => {
    onChange({ ...node, config: { ...cfg, ...patch } });
  };

  if (node.type === "loop") {
    return (
      <div className="je-tab je-tab--config">
        <ExprField
          label="Loop condition (expression)"
          value={(cfg.loopCondition as string) ?? ""}
          onChange={(v) => setCfg({ loopCondition: v })}
          readOnly={readOnly}
          sources={sources}
        />
        <p className="je-hint">
          Use the {"{x}"} button to insert a reference like <code>{"${nodeId.output.field}"}</code>.
          The loop body iterates while this expression is truthy.
        </p>
      </div>
    );
  }

  if (node.type === "timer") {
    return (
      <div className="je-tab je-tab--config">
        <ExprField
          label="Duration"
          value={(cfg.duration as string) ?? ""}
          onChange={(v) => setCfg({ duration: v })}
          readOnly={readOnly}
          sources={sources}
        />
        <ExprField
          label="Until (optional)"
          value={(cfg.until as string) ?? ""}
          onChange={(v) => setCfg({ until: v })}
          readOnly={readOnly}
          sources={sources}
        />
      </div>
    );
  }

  if (node.type === "human-task") {
    return <HumanTaskConfigEditor node={node} onChange={onChange} readOnly={readOnly} />;
  }

  return null;
}

interface HumanTaskEditorProps {
  node: FlowNode;
  onChange: (next: FlowNode) => void;
  readOnly?: boolean;
}

interface HumanTaskOutputCfg {
  name: string;
  type: "string" | "number" | "boolean" | "json" | "date";
  label?: string;
  description?: string;
  required?: boolean;
  default?: unknown;
  fromPath?: string;
}

function HumanTaskConfigEditor({ node, onChange, readOnly }: HumanTaskEditorProps) {
  const cfg = (node.config ?? {}) as {
    prompt?: string;
    outputs?: HumanTaskOutputCfg[];
    listensFor?: string[];
    acceptIf?: unknown;
    timeout?: { duration: string; defaults?: Record<string, unknown> };
  };
  const outputs = cfg.outputs ?? [];

  const [acceptIfDraft, setAcceptIfDraft] = useState<string>(
    cfg.acceptIf ? JSON.stringify(cfg.acceptIf, null, 2) : "",
  );
  const [acceptIfError, setAcceptIfError] = useState<string | null>(null);

  const [defaultsDraft, setDefaultsDraft] = useState<string>(
    cfg.timeout?.defaults ? JSON.stringify(cfg.timeout.defaults, null, 2) : "",
  );
  const [defaultsError, setDefaultsError] = useState<string | null>(null);

  const update = (patch: Partial<typeof cfg>) => {
    onChange({ ...node, config: { ...cfg, ...patch } });
  };

  const updateOutput = (idx: number, patch: Partial<HumanTaskOutputCfg>) => {
    const next = outputs.slice();
    next[idx] = { ...next[idx], ...patch };
    update({ outputs: next });
  };

  const removeOutput = (idx: number) => {
    update({ outputs: outputs.filter((_, i) => i !== idx) });
  };

  const addOutput = () => {
    const baseName = "field";
    let n = outputs.length + 1;
    let name = `${baseName}${n}`;
    while (outputs.some(o => o.name === name)) name = `${baseName}${++n}`;
    update({ outputs: [...outputs, { name, type: "string" }] });
  };

  return (
    <div className="je-tab je-tab--config je-humantask">
      <div className="je-field">
        <label className="je-field__label">Message to reviewer</label>
        <textarea
          rows={3}
          value={cfg.prompt ?? ""}
          disabled={readOnly}
          placeholder="e.g. Review the implementation and approve, or request changes with specifics."
          onChange={e => update({ prompt: e.target.value })}
        />
      </div>

      <div className="je-field">
        <label className="je-field__label">Outputs</label>
        <p className="je-hint">
          Fields this human-task produces. Each becomes <code>{node.id}.&lt;name&gt;</code> for downstream nodes.
        </p>
        <div className="je-humantask__outputs">
          {outputs.length === 0 && (
            <div className="je-humantask__empty">No outputs declared. Resolving will only emit meta keys.</div>
          )}
          {outputs.map((o, i) => (
            <div key={i} className="je-humantask__output-row">
              <input
                type="text"
                value={o.name}
                disabled={readOnly}
                placeholder="name"
                onChange={e => updateOutput(i, { name: e.target.value })}
                style={{ flex: 1 }}
              />
              <select
                value={o.type}
                disabled={readOnly}
                onChange={e => updateOutput(i, { type: e.target.value as HumanTaskOutputCfg["type"] })}
              >
                <option value="string">string</option>
                <option value="number">number</option>
                <option value="boolean">boolean</option>
                <option value="date">date</option>
                <option value="json">json</option>
              </select>
              <label className="je-humantask__inline-check">
                <input
                  type="checkbox"
                  checked={!!o.required}
                  disabled={readOnly}
                  onChange={e => updateOutput(i, { required: e.target.checked || undefined })}
                />
                req
              </label>
              <input
                type="text"
                value={o.fromPath ?? ""}
                disabled={readOnly}
                placeholder="webhook path (optional)"
                onChange={e => updateOutput(i, { fromPath: e.target.value || undefined })}
                style={{ flex: 2 }}
                title="Dot-path into the webhook payload to auto-fill this field"
              />
              {!readOnly && (
                <button
                  type="button"
                  className="je-humantask__chip-x"
                  aria-label="Remove output"
                  onClick={() => removeOutput(i)}
                >×</button>
              )}
            </div>
          ))}
        </div>
        {!readOnly && (
          <button type="button" className="je-humantask__btn" onClick={addOutput} style={{ marginTop: 6 }}>
            + Add output
          </button>
        )}
      </div>

      <div className="je-field">
        <label className="je-field__label">Listens for</label>
        <input
          type="text"
          placeholder="jira:issue_updated, github.pull_request.review"
          value={(cfg.listensFor ?? []).join(", ")}
          disabled={readOnly}
          onChange={e => update({
            listensFor: e.target.value.split(",").map(s => s.trim()).filter(Boolean),
          })}
        />
        <p className="je-hint">Comma-separated webhook event types this gate accepts. Empty = accept any.</p>
      </div>

      <div className="je-field">
        <label className="je-field__label">Accept if (JSONLogic, optional)</label>
        <textarea
          rows={6}
          className="je-humantask__code"
          value={acceptIfDraft}
          disabled={readOnly}
          placeholder='{"==": [{"var": "issue.fields.status.name"}, "Done"]}'
          onChange={e => {
            const text = e.target.value;
            setAcceptIfDraft(text);
            if (text.trim() === "") {
              setAcceptIfError(null);
              update({ acceptIf: undefined });
              return;
            }
            try {
              const parsed = JSON.parse(text);
              setAcceptIfError(null);
              update({ acceptIf: parsed });
            } catch (err) {
              setAcceptIfError(err instanceof Error ? err.message : "invalid JSON");
            }
          }}
        />
        {acceptIfError && <p className="je-hint je-hint--error">{acceptIfError}</p>}
        <p className="je-hint">
          Filter incoming webhooks by payload values. Supports <code>and</code>/<code>or</code>/<code>==</code>/<code>in</code>/etc.
          Example: <code>{`{"in": [{"var": "issue.fields.status.name"}, ["Review", "Done"]]}`}</code>.
        </p>
      </div>

      <div className="je-field">
        <label className="je-field__label">Timeout (optional)</label>
        <input
          type="text"
          placeholder="48h"
          value={cfg.timeout?.duration ?? ""}
          disabled={readOnly}
          onChange={e => {
            const duration = e.target.value;
            if (!duration) return update({ timeout: undefined });
            update({ timeout: { duration, defaults: cfg.timeout?.defaults } });
          }}
        />
        {cfg.timeout && (
          <>
            <textarea
              rows={4}
              className="je-humantask__code"
              value={defaultsDraft}
              disabled={readOnly}
              placeholder='{"decision": "abandon"}'
              style={{ marginTop: 6 }}
              onChange={e => {
                const text = e.target.value;
                setDefaultsDraft(text);
                if (text.trim() === "") {
                  setDefaultsError(null);
                  update({ timeout: { duration: cfg.timeout!.duration } });
                  return;
                }
                try {
                  const parsed = JSON.parse(text);
                  setDefaultsError(null);
                  update({ timeout: { duration: cfg.timeout!.duration, defaults: parsed } });
                } catch (err) {
                  setDefaultsError(err instanceof Error ? err.message : "invalid JSON");
                }
              }}
            />
            {defaultsError && <p className="je-hint je-hint--error">{defaultsError}</p>}
            <p className="je-hint">Default values to fill into outputs when the timeout fires.</p>
          </>
        )}
        {!cfg.timeout && (
          <p className="je-hint">Leave blank to wait indefinitely.</p>
        )}
      </div>
    </div>
  );
}
