import { Handle, Position, type NodeProps } from "@xyflow/react";
import { handleBlue } from "../handle-styles.ts";

export function LoopNode(props: NodeProps) {
  const data = props.data as { displayName?: string };
  return (
    <div className="je-node je-node--loop">
      <Handle type="target" position={Position.Left} style={handleBlue} />
      <div className="je-node__row">
        <div className="je-node__icon" style={{ background: "#fdcb6e" }}>↻</div>
        <div className="je-node__text">
          <div className="je-node__label">{data.displayName ?? "Loop"}</div>
          <div className="je-node__subtitle">do-while</div>
        </div>
      </div>
      {/* Body output goes downward (loop body); exit output continues right. */}
      <Handle type="source" position={Position.Bottom} id="body" style={handleBlue} />
      <Handle type="source" position={Position.Right} id="exit" style={handleBlue} />
    </div>
  );
}
