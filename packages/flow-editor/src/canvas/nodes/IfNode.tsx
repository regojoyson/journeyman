import { Handle, Position, type NodeProps } from "@xyflow/react";

export function IfNode(props: NodeProps) {
  const data = props.data as { displayName?: string };
  return (
    <div className="je-node je-node--if">
      <Handle type="target" position={Position.Top} />
      <div className="je-node__row">
        <div className="je-node__icon" style={{ background: "#74b9ff" }}>?</div>
        <div className="je-node__text">
          <div className="je-node__label">{data.displayName ?? "If"}</div>
          <div className="je-node__subtitle">then / else</div>
        </div>
      </div>
      <Handle type="source" position={Position.Bottom} id="then" style={{ left: "30%" }} />
      <Handle type="source" position={Position.Bottom} id="else" style={{ left: "70%" }} />
    </div>
  );
}
