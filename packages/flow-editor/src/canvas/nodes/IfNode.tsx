import { Handle, Position, type NodeProps } from "@xyflow/react";
import { handleBlue } from "../handle-styles.ts";

export function IfNode(props: NodeProps) {
  const data = props.data as { displayName?: string };
  return (
    <div className="je-node je-node--if">
      <Handle type="target" position={Position.Left} style={handleBlue} />
      <div className="je-node__row">
        <div className="je-node__icon" style={{ background: "#74b9ff" }}>?</div>
        <div className="je-node__text">
          <div className="je-node__label">{data.displayName ?? "If"}</div>
          <div className="je-node__subtitle">then / else</div>
        </div>
      </div>
      {/* Two outputs stacked on the right edge: top = then, bottom = else. */}
      <Handle type="source" position={Position.Right} id="then" style={{ ...handleBlue, top: "30%" }} />
      <Handle type="source" position={Position.Right} id="else" style={{ ...handleBlue, top: "70%" }} />
    </div>
  );
}
