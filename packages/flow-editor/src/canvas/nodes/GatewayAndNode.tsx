import { Handle, Position, type NodeProps } from "@xyflow/react";
import { handleBlue } from "../handle-styles.ts";

export interface GatewayAndNodeData {
  displayName?: string;
  branchCount?: number;
  [key: string]: unknown;
}

export function GatewayAndNode(props: NodeProps) {
  const data = props.data as GatewayAndNodeData;
  return (
    <div className="je-node je-node--gateway je-node--and">
      <Handle type="target" position={Position.Left} style={handleBlue} />
      <div className="je-node__icon">+</div>
      <div className="je-node__text">
        <div className="je-node__label">{data.displayName ?? "Fork"}</div>
        {typeof data.branchCount === "number" && data.branchCount > 0 && (
          <div className="je-node__subtitle">× {data.branchCount}</div>
        )}
      </div>
      <Handle type="source" position={Position.Right} id="default" style={handleBlue} />
    </div>
  );
}
