import { BaseEdge, EdgeLabelRenderer, getSmoothStepPath, type EdgeProps } from "@xyflow/react";

export function ElseEdge(props: EdgeProps) {
  const [path, labelX, labelY] = getSmoothStepPath({
    sourceX: props.sourceX, sourceY: props.sourceY,
    targetX: props.targetX, targetY: props.targetY,
    sourcePosition: props.sourcePosition,
    targetPosition: props.targetPosition,
    borderRadius: 8,
  });
  return (
    <>
      <BaseEdge id={props.id} path={path} markerEnd={props.markerEnd}
        style={{ stroke: "#888", strokeWidth: 2, strokeDasharray: "2 4" }} />
      <EdgeLabelRenderer>
        <div style={{ position: "absolute", transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)`,
          background: "#1a1a24", color: "#888", fontSize: 10, padding: "1px 6px", borderRadius: 4 }}>else</div>
      </EdgeLabelRenderer>
    </>
  );
}
