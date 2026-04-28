// TODO(T9): Edge condition (`FlowEdge.condition`, JSONLogic) is not yet
// editable from a properties surface. When an edge inspector is added,
// reuse `ValuePicker` from `properties-panel/ValuePicker.tsx` with
// `surface = "jsonlogic"` (see `insertRef` in
// `properties-panel/ControlNodeConfigTab.tsx`) and merge the picked
// `{ var: ref }` into the existing JSONLogic value (or replace if empty).
// The upstream `sourceNodeId` for the picker is `props.source` (this
// edge's origin node).
import { BaseEdge, EdgeLabelRenderer, getBezierPath, type EdgeProps } from "@xyflow/react";

export function ConditionalEdge(props: EdgeProps) {
  const [path, labelX, labelY] = getBezierPath({
    sourceX: props.sourceX, sourceY: props.sourceY,
    targetX: props.targetX, targetY: props.targetY,
    sourcePosition: props.sourcePosition,
    targetPosition: props.targetPosition,
  });
  const data = props.data as { branchLabel?: string; condition?: unknown } | undefined;
  const label = data?.branchLabel ?? "if";
  return (
    <>
      <BaseEdge id={props.id} path={path} markerEnd={props.markerEnd}
        style={{
          stroke: props.selected ? "#fff8c0" : "#fdcb6e",
          strokeWidth: props.selected ? 3.5 : 2,
          strokeDasharray: "6 4",
        }} />
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
