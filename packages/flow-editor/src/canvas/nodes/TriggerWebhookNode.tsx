import { Handle, Position } from "@xyflow/react";
import { handleBlue } from "../handle-styles.ts";

interface Data {
  displayName?: string;
  webhookId?: string;
}

export function TriggerWebhookNode({ data }: { data: Data }) {
  const label = data.displayName ?? "Webhook";
  const subtitle = data.webhookId ? "Webhook trigger · configured" : "Webhook trigger · pick a webhook";
  return (
    <div className="je-node je-node--trigger je-node--trigger-webhook">
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
