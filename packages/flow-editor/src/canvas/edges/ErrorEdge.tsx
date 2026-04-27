import { BaseEdge, getSmoothStepPath, type EdgeProps } from "@xyflow/react";

export function ErrorEdge(props: EdgeProps) {
  const [path] = getSmoothStepPath({
    sourceX: props.sourceX, sourceY: props.sourceY,
    targetX: props.targetX, targetY: props.targetY,
    sourcePosition: props.sourcePosition,
    targetPosition: props.targetPosition,
    borderRadius: 8,
  });
  return (
    <BaseEdge id={props.id} path={path} markerEnd={props.markerEnd}
      style={{ stroke: "#ff7675", strokeWidth: 2, strokeDasharray: "4 3" }} />
  );
}
