// packages/flow-editor/src/properties-panel/trigger-webhook-panel.tsx
import { useMemo } from "react";
import type {
  TriggerInputMapping,
  TriggerInputMappingType,
  TriggerWebhookConfig,
  WorkflowGraph,
  WorkflowNode,
} from "@journeyman/core";
import { AcceptIfBuilder } from "./AcceptIfBuilder.tsx";
import { ListensForPicker } from "./ListensForPicker.tsx";
import { pathsFromSchema } from "./useWebhooksForPicker.ts";

export interface WebhookOption {
  id: string;
  name: string;
  knownEventTypes?: string[];
  payloadSchema?: unknown;
}

export interface TriggerWebhookPanelProps {
  node: WorkflowNode;
  graph: WorkflowGraph;
  webhooks: WebhookOption[];
  onPatchConfig: (patch: Partial<TriggerWebhookConfig>) => void;
  readOnly?: boolean;
}

export function TriggerWebhookPanel({
  node,
  graph,
  webhooks,
  onPatchConfig,
  readOnly,
}: TriggerWebhookPanelProps): JSX.Element {
  const cfg = (node.config ?? {}) as unknown as TriggerWebhookConfig;
  const inputs = graph.inputDefs ?? [];
  const mapping: Record<string, TriggerInputMapping> = cfg.inputsMapping ?? {};

  const selectedWebhook = useMemo(
    () => webhooks.find((w) => w.id === cfg.webhookId),
    [webhooks, cfg.webhookId],
  );
  const knownPaths = useMemo(
    () => (selectedWebhook ? pathsFromSchema(selectedWebhook.payloadSchema) : []),
    [selectedWebhook],
  );
  const eventTypeOptions = selectedWebhook?.knownEventTypes ?? [];

  return (
    <div className="jm-properties-panel-section je-humantask">
      <h3>Webhook trigger</h3>

      <label>
        Webhook
        <select
          value={cfg.webhookId ?? ""}
          disabled={readOnly}
          onChange={(e) => onPatchConfig({ webhookId: e.target.value || undefined as unknown as string })}
        >
          <option value="">— select —</option>
          {webhooks.map((w) => (
            <option key={w.id} value={w.id}>{w.name}</option>
          ))}
        </select>
      </label>

      <div className="je-field">
        <label className="je-field__label">Listens for</label>
        <ListensForPicker
          value={cfg.listensFor ?? []}
          knownEventTypes={eventTypeOptions}
          webhookPicked={!!selectedWebhook}
          readOnly={readOnly}
          onChange={(next) => onPatchConfig({ listensFor: next.length > 0 ? next : undefined })}
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
          datalistId={`trigger-acceptif-paths-${node.id}`}
          onChange={(next) => onPatchConfig({ acceptIf: next as TriggerWebhookConfig["acceptIf"] })}
        />
      </div>

      <h4>Inputs mapping</h4>
      <datalist id={`trigger-input-paths-${node.id}`}>
        {knownPaths.map((p) => <option key={p} value={p} />)}
      </datalist>
      {inputs.length === 0 ? (
        <p>No workflow inputs declared. Add inputs in the Inputs tab first.</p>
      ) : (
        <table>
          <thead>
            <tr><th>Input</th><th>From path</th><th>Type</th></tr>
          </thead>
          <tbody>
            {inputs.map((inp) => {
              const m = mapping[inp.name];
              return (
                <tr key={inp.name}>
                  <td>{inp.name}{inp.required ? " *" : ""}</td>
                  <td>
                    <input
                      type="text"
                      list={`trigger-input-paths-${node.id}`}
                      placeholder="$.path.to.value"
                      value={m?.fromPath ?? ""}
                      disabled={readOnly}
                      onChange={(e) => {
                        const next = { ...mapping };
                        next[inp.name] = {
                          fromPath: e.target.value,
                          type: (m?.type ?? (inp.type as TriggerInputMappingType)),
                        };
                        onPatchConfig({ inputsMapping: next });
                      }}
                    />
                  </td>
                  <td>
                    <select
                      value={m?.type ?? inp.type}
                      disabled={readOnly}
                      onChange={(e) => {
                        const next = { ...mapping };
                        next[inp.name] = {
                          fromPath: m?.fromPath ?? "",
                          type: e.target.value as TriggerInputMappingType,
                        };
                        onPatchConfig({ inputsMapping: next });
                      }}
                    >
                      <option value="string">string</option>
                      <option value="number">number</option>
                      <option value="boolean">boolean</option>
                      <option value="json">json</option>
                    </select>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </div>
  );
}
