import { Handle, Position, type NodeProps } from "@xyflow/react";
import { handleBlue } from "../handle-styles.ts";
import type { StepRunState } from "../../step-definition.ts";
import { NodeIssueBadges } from "./NodeIssueBadges.tsx";
import { useWebhooksForPicker } from "../../properties-panel/useWebhooksForPicker.ts";

export interface WebhookWaitNodeData {
  displayName?: string;
  // Canvas adapter (Canvas.tsx#toReactWorkflowNodes) SPREADS node.config onto
  // data for non-step nodes — so config fields live at data root, not under
  // data.config. Match that shape here.
  /** New field: FK to a Webhook record. */
  webhookId?: string;
  /** Legacy field, retained for un-migrated nodes. */
  provider?: string;
  listensFor?: string[];
  outputs?: Array<{ name: string; type?: string }>;
  runState?: StepRunState;
  [key: string]: unknown;
}

export function WebhookWaitNode(props: NodeProps) {
  const data = props.data as WebhookWaitNodeData;
  const outputs = data.outputs ?? [];
  const isWaiting = data.runState?.status === "running";

  // Look up the webhook's display name from the shared cache (fetches once
  // per session across all webhook-wait nodes). Falls back to a short id
  // snippet while the cache is loading, then to the legacy `provider`
  // string for un-migrated nodes.
  const { webhooks } = useWebhooksForPicker();
  const selectedWebhook = data.webhookId ? webhooks.find((w) => w.id === data.webhookId) : undefined;

  const subtitleParts: string[] = [];
  if (data.webhookId) {
    subtitleParts.push(selectedWebhook?.name ?? `webhook ${data.webhookId.slice(0, 6)}…`);
  } else if (data.provider) {
    subtitleParts.push(data.provider);
  }
  if (outputs.length > 0) subtitleParts.push(outputs.map(o => o.name).join(", "));
  const subtitle = subtitleParts.length > 0 ? subtitleParts.join(" · ") : "(no webhook selected)";

  return (
    <div
      className="je-node je-node--human"
      style={{
        borderColor: "rgb(var(--color-info) / 1)",
        position: "relative",
        animation: isWaiting ? "je-pulse 1.5s ease-in-out infinite" : undefined,
      }}
    >
      <NodeIssueBadges nodeId={props.id} />
      <Handle type="target" position={Position.Left} style={handleBlue} />
      <div className="je-node__row">
        <div className="je-node__icon" style={{ background: "rgb(var(--color-info) / 1)" }}>🔔</div>
        <div className="je-node__text">
          <div className="je-node__label">{data.displayName ?? "Webhook Wait"}</div>
          <div className="je-node__subtitle" title={(data.listensFor ?? []).join(", ")}>
            {subtitle}
          </div>
        </div>
      </div>
      <Handle type="source" position={Position.Right} style={handleBlue} />
    </div>
  );
}
