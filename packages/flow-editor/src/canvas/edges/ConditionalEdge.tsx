import { BaseEdge, EdgeLabelRenderer, getSmoothStepPath, type EdgeProps } from "@xyflow/react";

export function ConditionalEdge(props: EdgeProps) {
  const [path, labelX, labelY] = getSmoothStepPath({
    sourceX: props.sourceX, sourceY: props.sourceY,
    targetX: props.targetX, targetY: props.targetY,
    sourcePosition: props.sourcePosition,
    targetPosition: props.targetPosition,
    borderRadius: 8,
  });
  const data = props.data as { branchLabel?: string; condition?: unknown } | undefined;
  const label = data?.branchLabel ?? "if";
  return (
    <>
      <BaseEdge id={props.id} path={path} markerEnd={props.markerEnd}
        style={{ stroke: "#fdcb6e", strokeWidth: 2, strokeDasharray: "6 4" }} />
      <EdgeLabelRenderer>
        <div style={{ position: "absolute", transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)`,
          background: "#1a1a24", border: "1px solid #fdcb6e", color: "#fdcb6e",
          fontSize: 10, padding: "1px 6px", borderRadius: 4, pointerEvents: "all" }}>
          {label}
        </div>
      </EdgeLabelRenderer>
    </>
  );
}
