import { useState } from "react";
import type { WorkflowNode } from "@journeyman/core";
import { AcceptIfBuilder } from "./AcceptIfBuilder.tsx";

interface WebhookWaitOutputCfg {
  name: string;
  type: "string" | "number" | "boolean" | "json" | "date";
  label?: string;
  description?: string;
  required?: boolean;
  default?: unknown;
  fromPath?: string;
}

interface Props {
  node: WorkflowNode;
  onChange: (next: WorkflowNode) => void;
  readOnly?: boolean;
}

const PROVIDERS = ["jira", "github", "gitlab", "monday", "linear", "api"] as const;

export function WebhookWaitConfigEditor({ node, onChange, readOnly }: Props) {
  const cfg = (node.config ?? {}) as {
    provider?: string;
    listensFor?: string[];
    acceptIf?: unknown;
    correlationKey?: "issueRef";
    outputs?: WebhookWaitOutputCfg[];
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

  const updateOutput = (idx: number, patch: Partial<WebhookWaitOutputCfg>) => {
    const next = outputs.slice();
    next[idx] = { ...next[idx], ...patch };
    update({ outputs: next });
  };

  const removeOutput = (idx: number) => {
    update({ outputs: outputs.filter((_, i) => i !== idx) });
  };

  const addOutput = () => {
    let n = outputs.length + 1;
    let name = `field${n}`;
    while (outputs.some(o => o.name === name)) name = `field${++n}`;
    update({ outputs: [...outputs, { name, type: "string" }] });
  };

  const knownPaths = Array.from(new Set(
    outputs.map(o => o.fromPath?.trim()).filter((p): p is string => !!p),
  ));

  return (
    <div className="je-tab je-tab--config je-humantask">
      <div className="je-field">
        <label className="je-field__label">Provider</label>
        <select
          value={cfg.provider ?? ""}
          disabled={readOnly}
          onChange={e => update({ provider: e.target.value })}
        >
          <option value="">— pick a provider —</option>
          {PROVIDERS.map(p => <option key={p} value={p}>{p}</option>)}
        </select>
        <p className="je-hint">Which provider's events resolve this node. Each provider has one webhook URL configured globally.</p>
      </div>

      <div className="je-field">
        <label className="je-field__label">Listens for</label>
        <input
          type="text"
          placeholder="e.g. jira:issue_updated, pull_request_review"
          value={(cfg.listensFor ?? []).join(", ")}
          disabled={readOnly}
          onChange={e => update({
            listensFor: e.target.value.split(",").map(s => s.trim()).filter(Boolean),
          })}
        />
        <p className="je-hint">Comma-separated event types. Empty means any event type from the provider.</p>
      </div>

      <div className="je-field">
        <label className="je-field__label">Accept if (optional)</label>
        <AcceptIfBuilder
          value={cfg.acceptIf}
          knownPaths={knownPaths}
          readOnly={readOnly}
          datalistId={`acceptif-paths-${node.id}`}
          onChange={next => update({ acceptIf: next })}
        />
        <datalist id={`acceptif-paths-${node.id}`}>
          {knownPaths.map(p => <option key={p} value={p} />)}
        </datalist>
        <p className="je-hint">Filter incoming webhooks by payload values.</p>
      </div>

      <div className="je-field">
        <label className="je-field__label">Correlation</label>
        <select
          value={cfg.correlationKey ?? "issueRef"}
          disabled={readOnly}
          onChange={e => update({ correlationKey: e.target.value as "issueRef" })}
        >
          <option value="issueRef">By issue reference</option>
        </select>
        <p className="je-hint">How this paused node binds to an incoming event. V1 supports issue-ref correlation only.</p>
      </div>

      <div className="je-field">
        <label className="je-field__label">Outputs</label>
        <p className="je-hint">Values extracted from the incoming payload to pass to later steps.</p>
        <div className="je-humantask__outputs">
          {outputs.length === 0 && (
            <div className="je-humantask__empty">No outputs declared. Meta keys (source, resolvedAt, payload) are still emitted.</div>
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
                onChange={e => updateOutput(i, { type: e.target.value as WebhookWaitOutputCfg["type"] })}
              >
                <option value="string">string</option>
                <option value="number">number</option>
                <option value="boolean">boolean</option>
                <option value="date">date</option>
                <option value="json">json</option>
              </select>
              <input
                type="text"
                value={o.fromPath ?? ""}
                disabled={readOnly}
                placeholder="e.g. issue.fields.status.name"
                onChange={e => updateOutput(i, { fromPath: e.target.value || undefined })}
                style={{ flex: 2 }}
              />
              {!readOnly && (
                <button type="button" className="je-humantask__chip-x" aria-label="Remove output" onClick={() => removeOutput(i)}>×</button>
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
        {cfg.timeout?.duration && (
          <>
            <textarea
              rows={3}
              placeholder='{"approved": false}'
              value={defaultsDraft}
              disabled={readOnly}
              onChange={e => {
                setDefaultsDraft(e.target.value);
                if (!e.target.value.trim()) {
                  setDefaultsError(null);
                  update({ timeout: { duration: cfg.timeout!.duration, defaults: undefined } });
                  return;
                }
                try {
                  const parsed = JSON.parse(e.target.value);
                  setDefaultsError(null);
                  update({ timeout: { duration: cfg.timeout!.duration, defaults: parsed } });
                } catch {
                  setDefaultsError("Invalid JSON");
                }
              }}
              style={{ marginTop: 6, width: "100%", fontFamily: "monospace" }}
            />
            {defaultsError && <p className="je-hint je-hint--error">{defaultsError}</p>}
          </>
        )}
        <p className="je-hint">When the timeout fires, declared outputs are filled from the JSON above and the workflow resumes.</p>
      </div>
    </div>
  );
}
