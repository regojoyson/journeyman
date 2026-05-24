import { Handle, Position, type NodeProps } from "@xyflow/react";
import { handleBlue } from "../handle-styles.ts";
import type { StepRunState } from "../../step-definition.ts";

export interface HumanTaskNodeData {
  displayName?: string;
  config?: {
    prompt?: string;
    outputs?: Array<{ name: string; type?: string }>;
  };
  /**
   * Optional run-time state. The canvas can pass `{ status: "running" }` here
   * when the node-execution row is in `waiting` status to render the waiting
   * visual treatment.
   */
  runState?: StepRunState;
  [key: string]: unknown;
}

export function HumanTaskNode(props: NodeProps) {
  const data = props.data as HumanTaskNodeData;
  const outputs = data.config?.outputs ?? [];
  const isWaiting = data.runState?.status === "running";

  const subtitle = outputs.length > 0
    ? outputs.map(o => o.name).join(", ")
    : "(no outputs declared)";

  return (
    <div
      className="je-node je-node--human"
      style={{
        borderColor: "#fbc531",
        position: "relative",
        animation: isWaiting ? "je-pulse 1.5s ease-in-out infinite" : undefined,
      }}
    >
      <Handle type="target" position={Position.Left} style={handleBlue} />
      <div className="je-node__row">
        <div className="je-node__icon" style={{ background: "#fbc531" }}>⏳</div>
        <div className="je-node__text">
          <div className="je-node__label">{data.displayName ?? "Human Task"}</div>
          <div className="je-node__subtitle" title={data.config?.prompt}>
            {subtitle}
          </div>
        </div>
      </div>
      <Handle type="source" position={Position.Right} style={handleBlue} />
    </div>
  );
}
