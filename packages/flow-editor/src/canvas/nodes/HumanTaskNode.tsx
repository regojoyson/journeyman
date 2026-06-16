import { Handle, Position, type NodeProps } from "@xyflow/react";
import { handleBlue } from "../handle-styles.ts";
import type { StepRunState } from "../../step-definition.ts";
import { NodeIssueBadges } from "./NodeIssueBadges.tsx";

export interface HumanTaskNodeData {
  displayName?: string;
  // Canvas adapter (Canvas.tsx#toReactWorkflowNodes) SPREADS node.config onto
  // data for non-step nodes — so config fields live at data root, not under
  // data.config. Match that shape here.
  prompt?: string;
  outputs?: Array<{ name: string; type?: string }>;
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
  const outputs = data.outputs ?? [];
  const isWaiting = data.runState?.status === "running";

  const subtitle = outputs.length > 0
    ? outputs.map(o => o.name).join(", ")
    : "(no outputs declared)";

  return (
    <div
      className="je-node je-node--human"
      style={{
        borderColor: "rgb(var(--color-warning) / 1)",
        position: "relative",
        animation: isWaiting ? "je-pulse 1.5s ease-in-out infinite" : undefined,
      }}
    >
      <NodeIssueBadges nodeId={props.id} />
      <Handle type="target" position={Position.Left} style={handleBlue} />
      <div className="je-node__row">
        <div className="je-node__icon" style={{ background: "rgb(var(--color-warning) / 1)" }}>⏳</div>
        <div className="je-node__text">
          <div className="je-node__label">{data.displayName ?? "Human Task"}</div>
          <div className="je-node__subtitle" title={data.prompt}>
            {subtitle}
          </div>
        </div>
      </div>
      <Handle type="source" position={Position.Right} style={handleBlue} />
    </div>
  );
}
