import { BaseEdge, getBezierPath, type EdgeProps } from "@xyflow/react";

export function ErrorEdge(props: EdgeProps) {
  const [path] = getBezierPath({
    sourceX: props.sourceX, sourceY: props.sourceY,
    targetX: props.targetX, targetY: props.targetY,
    sourcePosition: props.sourcePosition,
    targetPosition: props.targetPosition,
  });
  return (
    <BaseEdge id={props.id} path={path} markerEnd={props.markerEnd}
      style={{
        stroke: props.selected ? "#ffc1c0" : "#ff7675",
        strokeWidth: props.selected ? 3.5 : 2,
        strokeDasharray: "4 3",
      }} />
  );
}
