import { Handle, Position, type NodeProps } from "@xyflow/react";

export function LoopNode(props: NodeProps) {
  const data = props.data as { displayName?: string };
  return (
    <div className="je-node je-node--loop">
      <Handle type="target" position={Position.Top} />
      <div className="je-node__row">
        <div className="je-node__icon" style={{ background: "#fdcb6e" }}>↻</div>
        <div className="je-node__text">
          <div className="je-node__label">{data.displayName ?? "Loop"}</div>
          <div className="je-node__subtitle">do-while</div>
        </div>
      </div>
      <Handle type="source" position={Position.Bottom} id="body" />
      <Handle type="source" position={Position.Right} id="exit" />
    </div>
  );
}
