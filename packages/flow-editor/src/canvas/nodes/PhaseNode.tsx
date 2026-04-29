// packages/flow-editor/src/canvas/nodes/PhaseNode.tsx
import { Handle, Position, type NodeProps } from "@xyflow/react";
import { handleBlue, handleRed } from "../handle-styles.ts";
import { usePhaseRegistry } from "../../state/phase-registry-context.tsx";
import type { PhaseRunState } from "../../phase-definition.ts";

export interface PhaseNodeData {
  displayName: string;
  phaseType: string;
  config?: Record<string, unknown>;
  inputs?: Record<string, { kind: string; ref?: string; value?: unknown } | undefined>;
  runState?: PhaseRunState;
  [key: string]: unknown;
}

const STATUS_COLORS: Record<PhaseRunState["status"], string> = {
  idle:      "#999",
  running:   "#4a9eff",
  succeeded: "#00b894",
  failed:    "#ff7675",
};

function DefaultStatusBadge({ state }: { state: PhaseRunState }) {
  return (
    <div
      title={state.message ?? state.status}
      style={{
        position: "absolute",
        top: 4,
        right: 4,
        width: 8,
        height: 8,
        borderRadius: "50%",
        background: STATUS_COLORS[state.status],
      }}
    />
  );
}

export function PhaseNode(props: NodeProps) {
  const data = props.data as PhaseNodeData;
  const registry = usePhaseRegistry();
  const definition = registry.get(data.phaseType);
  const accent = definition?.color ?? "#6c5ce7";
  const icon = definition?.icon ?? "⚙";
  const subtitle =
    (definition?.summary && definition.summary(data.config ?? {}, { inputs: data.inputs })) ||
    definition?.label ||
    data.phaseType;
  const Badge = definition?.StatusBadge ?? DefaultStatusBadge;

  return (
    <div className="je-node je-node--phase" style={{ borderColor: accent, position: "relative" }}>
      {data.runState && <Badge state={data.runState} />}
      <Handle type="target" position={Position.Left} style={handleBlue} />
      <div className="je-node__row">
        <div className="je-node__icon" style={{ background: accent }}>{icon}</div>
        <div className="je-node__text">
          <div className="je-node__label">{data.displayName}</div>
          <div className="je-node__subtitle">{subtitle}</div>
        </div>
      </div>
      <Handle type="source" position={Position.Right} id="default" style={handleBlue} />
      <Handle type="source" position={Position.Bottom} id="error" style={handleRed} title="Error output" />
    </div>
  );
}
