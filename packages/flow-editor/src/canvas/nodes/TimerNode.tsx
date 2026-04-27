import { Handle, Position, type NodeProps } from "@xyflow/react";

export function TimerNode(props: NodeProps) {
  const data = props.data as { displayName?: string; duration?: string };
  return (
    <div className="je-node je-node--timer">
      <Handle type="target" position={Position.Top} />
      <div className="je-node__row">
        <div className="je-node__icon" style={{ background: "#fdcb6e" }}>⏱</div>
        <div className="je-node__text">
          <div className="je-node__label">{data.displayName ?? "Wait"}</div>
          <div className="je-node__subtitle">{data.duration ?? "—"}</div>
        </div>
      </div>
      <Handle type="source" position={Position.Bottom} />
    </div>
  );
}
