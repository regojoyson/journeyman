import { useMemo, useState } from "react";
import type { WorkflowNode } from "@journeyman/core";
import { AcceptIfBuilder } from "./AcceptIfBuilder.tsx";
import { pathsFromSchema, useWebhooksForPicker } from "./useWebhooksForPicker.ts";

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

export function WebhookWaitConfigEditor({ node, onChange, readOnly }: Props) {
  const cfg = (node.config ?? {}) as {
    webhookId?: string;
    listensFor?: string[];
    acceptIf?: unknown;
    correlationKey?: "issueRef";
    outputs?: WebhookWaitOutputCfg[];
    timeout?: { duration: string; defaults?: Record<string, unknown> };
  };
  const outputs = cfg.outputs ?? [];

  const { webhooks, loading: loadingWebhooks } = useWebhooksForPicker();
  const selectedWebhook = useMemo(
    () => webhooks.find((w) => w.id === cfg.webhookId),
    [webhooks, cfg.webhookId],
  );
  const suggestedPaths = useMemo(
    () => (selectedWebhook ? pathsFromSchema(selectedWebhook.payloadSchema) : []),
    [selectedWebhook],
  );

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

// ---------------------------------------------------------------------------
// ListensForPicker: chip multi-select for webhook event-type filters.
// ---------------------------------------------------------------------------

interface ListensForPickerProps {
  value: string[];
  knownEventTypes: string[];
  webhookPicked: boolean;
  readOnly?: boolean;
  onChange: (next: string[]) => void;
}

function ListensForPicker({
  value,
  knownEventTypes,
  webhookPicked,
  readOnly,
  onChange,
}: ListensForPickerProps) {
  const [customDraft, setCustomDraft] = useState<string | null>(null);
  // null = dropdown mode; string (incl. "") = custom-input mode

  const remaining = knownEventTypes.filter((t) => !value.includes(t));
  const isCustomMode = customDraft !== null;

  function add(eventType: string) {
    const trimmed = eventType.trim();
    if (!trimmed) return;
    if (value.includes(trimmed)) return;
    onChange([...value, trimmed]);
  }

  function remove(eventType: string) {
    onChange(value.filter((t) => t !== eventType));
  }

  function onDropdownChange(e: React.ChangeEvent<HTMLSelectElement>) {
    const picked = e.target.value;
    if (!picked) return;
    if (picked === "__custom__") {
      setCustomDraft("");
      return;
    }
    add(picked);
    e.target.value = "";
  }

  function commitCustom() {
    if (customDraft === null) return;
    add(customDraft);
    setCustomDraft(null);
  }

  function cancelCustom() {
    setCustomDraft(null);
  }

  return (
    <div>
      <div
        style={{
          display: "flex",
          flexWrap: "wrap",
          gap: 6,
          padding: "6px 8px",
          minHeight: 32,
          border: "1px solid var(--je-border, #2a2f3a)",
          borderRadius: 4,
          background: "var(--je-input-bg, #1a1d24)",
        }}
      >
        {value.length === 0 ? (
          <span style={{ color: "#777", fontSize: 12, fontStyle: "italic" }}>
            (no filters — accepts any event type)
          </span>
        ) : (
          value.map((t) => (
            <span
              key={t}
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 4,
                padding: "2px 6px",
                background: "#4a9eff22",
                color: "#9cc7ff",
                borderRadius: 3,
                fontSize: 12,
                fontFamily: "monospace",
              }}
            >
              {t}
              {!readOnly && (
                <button
                  type="button"
                  onClick={() => remove(t)}
                  aria-label={`Remove ${t}`}
                  style={{
                    border: "none",
                    background: "transparent",
                    color: "#9cc7ff",
                    cursor: "pointer",
                    padding: 0,
                    fontSize: 14,
                    lineHeight: 1,
                  }}
                >
                  ×
                </button>
              )}
            </span>
          ))
        )}
      </div>

      {!readOnly && (
        <div style={{ marginTop: 6 }}>
          {isCustomMode ? (
            <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
              <input
                autoFocus
                type="text"
                placeholder="custom event type"
                value={customDraft ?? ""}
                onChange={(e) => setCustomDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    commitCustom();
                  } else if (e.key === "Escape") {
                    e.preventDefault();
                    cancelCustom();
                  }
                }}
                style={{ flex: 1 }}
              />
              <button type="button" onClick={commitCustom} aria-label="Add custom event type">
                ✓
              </button>
              <button type="button" onClick={cancelCustom} aria-label="Cancel">
                ×
              </button>
            </div>
          ) : (
            <select
              value=""
              disabled={!webhookPicked}
              onChange={onDropdownChange}
            >
              <option value="">
                {webhookPicked ? "+ Add event type" : "Pick a webhook above first"}
              </option>
              {remaining.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
              <option value="__custom__">✏  Custom event type…</option>
            </select>
          )}
        </div>
      )}
    </div>
  );
}
