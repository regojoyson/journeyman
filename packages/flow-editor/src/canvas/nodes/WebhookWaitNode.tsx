import { Handle, Position, type NodeProps } from "@xyflow/react";
import { handleBlue } from "../handle-styles.ts";
import type { StepRunState } from "../../step-definition.ts";
import { NodeIssueBadges } from "./NodeIssueBadges.tsx";

export interface WebhookWaitNodeData {
  displayName?: string;
  config?: {
    /** New field: FK to a Webhook record. */
    webhookId?: string;
    /** Legacy field, retained for un-migrated nodes. */
    provider?: string;
    listensFor?: string[];
    outputs?: Array<{ name: string; type?: string }>;
  };
  runState?: StepRunState;
  [key: string]: unknown;
}

export function WebhookWaitNode(props: NodeProps) {
  const data = props.data as WebhookWaitNodeData;
  const outputs = data.config?.outputs ?? [];
  const isWaiting = data.runState?.status === "running";

  // Prefer the new webhookId (current config shape). Fall back to the legacy
  // provider string for nodes that pre-date the webhook picker. Show an empty
  // state only when neither is set.
  const subtitleParts: string[] = [];
  if (data.config?.webhookId) {
    subtitleParts.push("webhook ✓");
  } else if (data.config?.provider) {
    subtitleParts.push(data.config.provider);
  }
  if (outputs.length > 0) subtitleParts.push(outputs.map(o => o.name).join(", "));
  const subtitle = subtitleParts.length > 0 ? subtitleParts.join(" · ") : "(no webhook selected)";

  return (
    <div
      className="je-node je-node--human"
      style={{
        borderColor: "#00a8ff",
        position: "relative",
        animation: isWaiting ? "je-pulse 1.5s ease-in-out infinite" : undefined,
      }}
    >
      <NodeIssueBadges nodeId={props.id} />
      <Handle type="target" position={Position.Left} style={handleBlue} />
      <div className="je-node__row">
        <div className="je-node__icon" style={{ background: "#00a8ff" }}>🔔</div>
        <div className="je-node__text">
          <div className="je-node__label">{data.displayName ?? "Webhook Wait"}</div>
          <div className="je-node__subtitle" title={(data.config?.listensFor ?? []).join(", ")}>
            {subtitle}
          </div>
        </div>
      </div>
      <Handle type="source" position={Position.Right} style={handleBlue} />
    </div>
  );
}
