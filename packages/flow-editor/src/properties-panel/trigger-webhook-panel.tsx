// packages/flow-editor/src/properties-panel/trigger-webhook-panel.tsx
import type {
  TriggerInputMapping,
  TriggerInputMappingType,
  TriggerWebhookConfig,
  WorkflowGraph,
  WorkflowNode,
} from "@journeyman/core";

export interface WebhookOption {
  id: string;
  name: string;
}

export interface TriggerWebhookPanelProps {
  node: WorkflowNode;
  graph: WorkflowGraph;
  webhooks: WebhookOption[];
  onPatchConfig: (patch: Partial<TriggerWebhookConfig>) => void;
}

export function TriggerWebhookPanel({
  node,
  graph,
  webhooks,
  onPatchConfig,
}: TriggerWebhookPanelProps): JSX.Element {
  const cfg = (node.config ?? {}) as unknown as TriggerWebhookConfig;
  const inputs = graph.inputDefs ?? [];
  const mapping: Record<string, TriggerInputMapping> = cfg.inputsMapping ?? {};

  return (
    <div className="jm-properties-panel-section">
      <h3>Webhook trigger</h3>

      <label>
        Webhook
        <select
          value={cfg.webhookId ?? ""}
          onChange={(e) => onPatchConfig({ webhookId: e.target.value || undefined as unknown as string })}
        >
          <option value="">— select —</option>
          {webhooks.map((w) => (
            <option key={w.id} value={w.id}>{w.name}</option>
          ))}
        </select>
      </label>

      <label>
        Listens for (event types, comma-separated; empty = all)
        <input
          type="text"
          value={(cfg.listensFor ?? []).join(", ")}
          onChange={(e) => {
            const v = e.target.value.split(",").map((s) => s.trim()).filter(Boolean);
            onPatchConfig({ listensFor: v.length ? v : undefined });
          }}
        />
      </label>

      <label>
        Accept-if (JSONLogic — JSON)
        <textarea
          rows={4}
          defaultValue={cfg.acceptIf ? JSON.stringify(cfg.acceptIf, null, 2) : ""}
          onBlur={(e) => {
            try {
              onPatchConfig({ acceptIf: e.target.value ? JSON.parse(e.target.value) : undefined });
            } catch {
              /* keep last good value */
            }
          }}
        />
      </label>

      <h4>Inputs mapping</h4>
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
                      placeholder="$.path.to.value"
                      value={m?.fromPath ?? ""}
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

      <label>
        IssueRef from path (optional)
        <input
          type="text"
          value={cfg.issueRefFromPath ?? ""}
          onChange={(e) => onPatchConfig({ issueRefFromPath: e.target.value || undefined })}
        />
      </label>
    </div>
  );
}
