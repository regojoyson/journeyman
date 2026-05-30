import { useMemo, useState } from "react";
import type { CorrelationKey, WorkflowInputValue, WorkflowNode } from "@journeyman/core";
import { validatePauseNodeOutputNames } from "@journeyman/core";
import { AcceptIfBuilder } from "./AcceptIfBuilder.tsx";
import { ListensForPicker } from "./ListensForPicker.tsx";
import { pathsFromSchema, useWebhooksForPicker } from "./useWebhooksForPicker.ts";
import { MentionInput } from "./MentionInput.tsx";
import { toMentionFields } from "./mention-fields.ts";
import type { UpstreamSource } from "./use-upstream-sources.ts";
import { correlationValueToSegments, segmentsToCorrelationValue } from "./correlation-value.ts";

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
  /** Upstream sources for the correlation @-mention picker (from ControlNodeConfigTab). */
  sources: UpstreamSource[];
}

export function WebhookWaitConfigEditor({ node, onChange, readOnly, sources }: Props) {
  const cfg = (node.config ?? {}) as {
    webhookId?: string;
    listensFor?: string[];
    acceptIf?: unknown;
    correlationKey?: CorrelationKey;
    outputs?: WebhookWaitOutputCfg[];
    timeout?: { duration: string; defaults?: Record<string, unknown> };
  };
  const outputs = cfg.outputs ?? [];

  const nameProblems = useMemo(() => {
    const byIndex = new Map<number, string>();
    for (const p of validatePauseNodeOutputNames(node)) byIndex.set(p.index, p.message);
    return byIndex;
  }, [node]);

  const { webhooks, loading: loadingWebhooks } = useWebhooksForPicker();
  const selectedWebhook = useMemo(
    () => webhooks.find((w) => w.id === cfg.webhookId),
    [webhooks, cfg.webhookId],
  );
  const suggestedPaths = useMemo(
    () => (selectedWebhook ? pathsFromSchema(selectedWebhook.payloadSchema) : []),
    [selectedWebhook],
  );
  const mentionFields = useMemo(() => toMentionFields(sources), [sources]);

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
    while (outputs.some((o) => o.name === name)) name = `field${++n}`;
    update({ outputs: [...outputs, { name, type: "string" }] });
  };

  const knownPaths = Array.from(new Set([
    ...suggestedPaths,
    ...outputs.map((o) => o.fromPath?.trim()).filter((p): p is string => !!p),
  ]));

  const datalistId = `webhook-paths-${node.id}`;
  const eventTypeOptions = selectedWebhook?.knownEventTypes ?? [];

  return (
    <div className="je-tab je-tab--config je-humantask">
      {/* New: webhook picker. Legacy provider field shown below for un-migrated nodes. */}
      <div className="je-field">
        <label className="je-field__label">Webhook</label>
        <select
          value={cfg.webhookId ?? ""}
          disabled={readOnly || loadingWebhooks}
          onChange={(e) => update({ webhookId: e.target.value || undefined })}
        >
          <option value="">— pick a webhook —</option>
          {webhooks.map((w) => (
            <option key={w.id} value={w.id}>
              {w.name} ({w.preset})
            </option>
          ))}
        </select>
        <p className="je-hint">
          {selectedWebhook
            ? `Schema-aware. ${suggestedPaths.length} paths suggested below.`
            : "Pick a registered webhook — required to publish this node."}
        </p>
      </div>

      <div className="je-field">
        <label className="je-field__label">Listens for</label>
        <ListensForPicker
          value={cfg.listensFor ?? []}
          knownEventTypes={eventTypeOptions}
          webhookPicked={!!selectedWebhook}
          readOnly={readOnly}
          onChange={(next) => update({ listensFor: next.length > 0 ? next : undefined })}
        />
        <p className="je-hint">
          Empty means any event type. Custom values are allowed for event types not in the preset.
        </p>
      </div>

      <div className="je-field">
        <label className="je-field__label">Correlation</label>
        <p className="je-hint">
          When an event arrives, Journeyman matches it to a paused run by comparing
          one value from the incoming event to one value from this run. If they're
          equal, the run resumes.
        </p>

        <label className="je-corr-sublabel">Event field</label>
        <p className="je-hint">Path into the incoming webhook payload.</p>
        <input
          type="text"
          placeholder="e.g. $.pull_request.number"
          list={datalistId}
          value={cfg.correlationKey?.eventPath ?? ""}
          disabled={readOnly}
          onChange={(e) => {
            const eventPath = e.target.value;
            const value: WorkflowInputValue =
              cfg.correlationKey?.value ?? { kind: "template", template: "" };
            update({ correlationKey: { eventPath, value } });
          }}
        />
        {!selectedWebhook && (
          <p className="je-hint">Pick a webhook above to get path suggestions.</p>
        )}

        <span className="je-corr-equals">equals</span>

        <label className="je-corr-sublabel">Value from this run</label>
        <p className="je-hint">Type @ to insert a field from run inputs or upstream steps.</p>
        <MentionInput
          value={correlationValueToSegments(cfg.correlationKey?.value)}
          fields={mentionFields}
          placeholder="Value from this run (type @)"
          readOnly={readOnly}
          onChange={(segs) => {
            const eventPath = cfg.correlationKey?.eventPath ?? "";
            update({ correlationKey: { eventPath, value: segmentsToCorrelationValue(segs) } });
          }}
        />
      </div>

      <div className="je-field">
        <label className="je-field__label">Accept if (optional)</label>
        <AcceptIfBuilder
          value={cfg.acceptIf}
          knownPaths={knownPaths}
          readOnly={readOnly}
          datalistId={`acceptif-paths-${node.id}`}
          onChange={(next) => update({ acceptIf: next })}
        />
      </div>

      <div className="je-field">
        <label className="je-field__label">Outputs</label>
        <datalist id={datalistId}>
          {suggestedPaths.map((p) => <option key={p} value={p} />)}
        </datalist>
        {outputs.length === 0 && (
          <p className="je-hint">No outputs yet. Add one to extract a value from incoming payloads.</p>
        )}
        {outputs.map((o, i) => (
          <div
            key={i}
            style={{ display: "flex", gap: 6, alignItems: "center", marginBottom: 6 }}
          >
            <input
              type="text"
              placeholder="field name"
              value={o.name}
              disabled={readOnly}
              onChange={(e) => updateOutput(i, { name: e.target.value })}
              style={{ flex: "0 0 120px" }}
            />
            <select
              value={o.type}
              disabled={readOnly}
              onChange={(e) => updateOutput(i, { type: e.target.value as WebhookWaitOutputCfg["type"] })}
              style={{ flex: "0 0 96px" }}
            >
              <option value="string">string</option>
              <option value="number">number</option>
              <option value="boolean">boolean</option>
              <option value="json">json</option>
              <option value="date">date</option>
            </select>
            <input
              type="text"
              list={datalistId}
              placeholder="fromPath e.g. $.pull_request.number"
              value={o.fromPath ?? ""}
              disabled={readOnly}
              onChange={(e) => updateOutput(i, { fromPath: e.target.value || undefined })}
              style={{ flex: "1 1 auto", minWidth: 0 }}
            />
            <button
              type="button"
              disabled={readOnly}
              onClick={() => removeOutput(i)}
              style={{ flex: "0 0 auto" }}
            >
              ×
            </button>
            {nameProblems.has(i) && (
              <p className="je-hint je-hint--error" style={{ flexBasis: "100%" }}>{nameProblems.get(i)}</p>
            )}
          </div>
        ))}
        {!readOnly && (
          <button type="button" onClick={addOutput} className="je-add-output">
            + Add output
          </button>
        )}
      </div>

      <div className="je-field">
        <label className="je-field__label">Timeout (optional)</label>
        <input
          type="text"
          placeholder="e.g. 24h"
          value={cfg.timeout?.duration ?? ""}
          disabled={readOnly}
          onChange={(e) =>
            update({
              timeout: e.target.value
                ? { duration: e.target.value, defaults: cfg.timeout?.defaults }
                : undefined,
            })
          }
        />
        <textarea
          rows={4}
          placeholder='{ "fieldName": "default value" }'
          value={defaultsDraft}
          disabled={readOnly || !cfg.timeout?.duration}
          onChange={(e) => {
            const text = e.target.value;
            setDefaultsDraft(text);
            setDefaultsError(null);
            if (!text.trim()) {
              update({ timeout: cfg.timeout ? { ...cfg.timeout, defaults: undefined } : undefined });
              return;
            }
            try {
              const parsed = JSON.parse(text) as Record<string, unknown>;
              if (cfg.timeout) update({ timeout: { ...cfg.timeout, defaults: parsed } });
            } catch (err) {
              setDefaultsError(err instanceof Error ? err.message : String(err));
            }
          }}
        />
        {defaultsError && <p className="je-hint je-hint--error">{defaultsError}</p>}
      </div>
    </div>
  );
}

