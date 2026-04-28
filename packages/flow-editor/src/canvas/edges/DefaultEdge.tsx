import { BaseEdge, getBezierPath, type EdgeProps } from "@xyflow/react";

export function DefaultEdge(props: EdgeProps) {
  const [path] = getBezierPath({
    sourceX: props.sourceX, sourceY: props.sourceY,
    targetX: props.targetX, targetY: props.targetY,
    sourcePosition: props.sourcePosition,
    targetPosition: props.targetPosition,
  });
  const stroke = props.selected ? "#4a9eff" : "#888";
  const width = props.selected ? 3 : 2;
  return <BaseEdge id={props.id} path={path} markerEnd={props.markerEnd}
    style={{ stroke, strokeWidth: width }} />;
}
