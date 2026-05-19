import { BaseEdge, EdgeLabelRenderer, getBezierPath, type EdgeProps } from "@xyflow/react";

export function ElseEdge(props: EdgeProps) {
  const [path, labelX, labelY] = getBezierPath({
    sourceX: props.sourceX, sourceY: props.sourceY,
    targetX: props.targetX, targetY: props.targetY,
    sourcePosition: props.sourcePosition,
    targetPosition: props.targetPosition,
  });
  return (
    <>
      <BaseEdge id={props.id} path={path} markerEnd={props.markerEnd}
        style={{
          stroke: props.selected ? "#ddd" : "#888",
          strokeWidth: props.selected ? 3.5 : 2,
          strokeDasharray: "2 4",
        }} />
      <EdgeLabelRenderer>
        <div style={{ position: "absolute", transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)`,
          background: "#1a1a24", color: "#888", fontSize: 10, padding: "1px 6px", borderRadius: 4 }}>else</div>
      </EdgeLabelRenderer>
    </>
  );
}
