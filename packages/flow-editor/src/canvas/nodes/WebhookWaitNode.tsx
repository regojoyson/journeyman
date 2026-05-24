import { Handle, Position, type NodeProps } from "@xyflow/react";
import { handleBlue } from "../handle-styles.ts";
import type { StepRunState } from "../../step-definition.ts";

export interface WebhookWaitNodeData {
  displayName?: string;
  config?: {
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

  const subtitleParts: string[] = [];
  if (data.config?.provider) subtitleParts.push(data.config.provider);
  if (outputs.length > 0) subtitleParts.push(outputs.map(o => o.name).join(", "));
  const subtitle = subtitleParts.length > 0 ? subtitleParts.join(" · ") : "(no provider)";

  return (
    <div
      className="je-node je-node--human"
      style={{
        borderColor: "#00a8ff",
        position: "relative",
        animation: isWaiting ? "je-pulse 1.5s ease-in-out infinite" : undefined,
      }}
    >
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
