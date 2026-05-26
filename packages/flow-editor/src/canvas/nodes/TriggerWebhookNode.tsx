import { Handle, Position, type NodeProps } from "@xyflow/react";
import { handleBlue } from "../handle-styles.ts";
import { NodeIssueBadges } from "./NodeIssueBadges.tsx";

interface Data {
  displayName?: string;
  webhookId?: string;
}

export function TriggerWebhookNode(props: NodeProps) {
  const data = props.data as Data;
  const label = data.displayName ?? "Webhook";
  const subtitle = data.webhookId ? "Webhook trigger · configured" : "Webhook trigger · pick a webhook";
  return (
    <div className="je-node je-node--trigger je-node--trigger-webhook">
      <NodeIssueBadges nodeId={props.id} />
      <div className="je-node__row">
        <div className="je-node__icon">🪝</div>
        <div className="je-node__text">
          <div className="je-node__label" title={label}>{label}</div>
          <div className="je-node__subtitle" title={subtitle}>{subtitle}</div>
        </div>
      </div>
      <Handle type="source" position={Position.Right} style={handleBlue} />
    </div>
  );
}
