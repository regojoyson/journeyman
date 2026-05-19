// packages/flow-editor/src/properties-panel/ControlNodeConfigTab.tsx
//
// T9: ValuePicker reuse for loop / timer expression surfaces.
//
// Conductor expression surfaces (loopCondition, until, duration) accept
// the literal string `${ref}`. JSONLogic surfaces (edge condition) wrap as
// `{ var: ref }`.
//
// TODO(T9): Add an Inspector / edge-properties surface so that
// WorkflowEdge.condition (JSONLogic) can be edited with the {x} ValuePicker
// button. Today, edges are not selectable in the PropertiesPanel — they
// only render via ConditionalEdge.tsx with a static branch label. Once an
// edge inspector exists, plug ValuePicker in there using
// `surface = "jsonlogic"` and merge the picked `{ var: ref }` into the
// existing JSONLogic value (or replace if empty).
import { useState } from "react";
import type { WorkflowGraph, WorkflowNode } from "@journeyman/core";
import { ValuePicker } from "./ValuePicker.tsx";
import { AcceptIfBuilder } from "./AcceptIfBuilder.tsx";
import { useUpstreamSources, collectCustomStepIds } from "./use-upstream-sources.ts";
import { useStepCatalog } from "../catalogs/use-step-catalog.ts";
import { useCustomStepDefs } from "../catalogs/use-custom-step-defs.ts";

interface Props {
  flow: WorkflowGraph;
  node: WorkflowNode;
  onChange: (next: WorkflowNode) => void;
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
  const catalog = useStepCatalog();
  const customStepDefs = useCustomStepDefs(collectCustomStepIds(flow));
  const sources = useUpstreamSources(flow, node.id, catalog, customStepDefs);
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
  node: WorkflowNode;
  onChange: (next: WorkflowNode) => void;
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
        <label className="je-field__label">Instructions</label>
        <textarea
          rows={3}
          value={cfg.prompt ?? ""}
          disabled={readOnly}
          placeholder="e.g. Approve this change, or request edits with specifics."
          onChange={e => update({ prompt: e.target.value })}
        />
        <p className="je-hint">Shown to the person resolving this task. Plain text — no formatting.</p>
      </div>

      <div className="je-field">
        <label className="je-field__label">Outputs</label>
        <p className="je-hint">
          What the human (or an incoming webhook) supplies to resolve this task. Each row is one value that later steps in this workflow can use.
        </p>
        <div className="je-humantask__outputs">
          {outputs.length > 0 && (
            <div className="je-humantask__output-header" aria-hidden="true">
              <span
                className="spacer-name"
                title="How downstream nodes will reference this output (e.g. human-task_X.<name>)."
              >Name</span>
              <span title="Value type — controls how the form input renders and how the value is coerced.">Type</span>
              <span title="If checked, manual resolution must fill this field.">Req</span>
              <span
                className="spacer-payload"
                title="Optional dot-path into the incoming webhook payload. When a webhook resolves this task, the value at this path becomes the output's value."
              >Payload source</span>
              <span className="spacer-x" />
            </div>
          )}
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
                placeholder="e.g. issue.fields.status.name"
                onChange={e => updateOutput(i, { fromPath: e.target.value || undefined })}
                style={{ flex: 2 }}
                title="Dot-path into the incoming webhook payload. The matcher reads this to fill the output automatically."
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
          list={`listensfor-${node.id}`}
          placeholder="e.g. jira:issue_updated, pull_request_review"
          value={(cfg.listensFor ?? []).join(", ")}
          disabled={readOnly}
          title="Comma-separated. The webhook's event type must be in this list (or the list must be empty)."
          onChange={e => update({
            listensFor: e.target.value.split(",").map(s => s.trim()).filter(Boolean),
          })}
        />
        <datalist id={`listensfor-${node.id}`}>
          <option value="jira:issue_updated">Jira — issue updated</option>
          <option value="jira:issue_created">Jira — issue created</option>
          <option value="jira:issue_deleted">Jira — issue deleted</option>
          <option value="pull_request">GitHub — pull request</option>
          <option value="pull_request_review">GitHub — PR review submitted</option>
          <option value="issues">GitHub — issue activity</option>
          <option value="issue_comment">GitHub — issue/PR comment</option>
          <option value="create">Linear — created</option>
          <option value="update">Linear — updated</option>
          <option value="remove">Linear — removed</option>
        </datalist>
        <p className="je-hint">
          Which webhook event types will resolve this task. Empty means any event type is accepted.
          Type the exact value the provider sends — pick from the list as a starting point.
        </p>
      </div>

      <div className="je-field">
        <label className="je-field__label">Accept if (optional)</label>
        <AcceptIfBuilder
          value={cfg.acceptIf}
          knownPaths={Array.from(new Set(
            outputs.map(o => o.fromPath?.trim()).filter((p): p is string => !!p)
          ))}
          readOnly={readOnly}
          datalistId={`acceptif-paths-${node.id}`}
          onChange={next => update({ acceptIf: next })}
        />
        <datalist id={`acceptif-paths-${node.id}`}>
          {Array.from(new Set(
            outputs.map(o => o.fromPath?.trim()).filter((p): p is string => !!p)
          )).map(p => <option key={p} value={p} />)}
        </datalist>
        <p className="je-hint">
          Filter incoming webhooks by payload values. Use the visual builder or switch to JSON for advanced expressions.
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
