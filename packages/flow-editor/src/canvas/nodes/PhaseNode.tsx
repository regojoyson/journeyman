import { Handle, Position, type NodeProps } from "@xyflow/react";
import type { PhaseCatalogEntry } from "../../types.ts";

export interface PhaseNodeData {
  displayName: string;
  phaseType: string;
  catalogEntry?: PhaseCatalogEntry;
  [key: string]: unknown;
}

export function PhaseNode(props: NodeProps) {
  const data = props.data as PhaseNodeData;
  const accent = data.catalogEntry?.color ?? "#6c5ce7";
  const icon = data.catalogEntry?.icon ?? "⚙";
  const subtitle = data.catalogEntry?.label ?? data.phaseType;
  return (
    <div className="je-node je-node--phase" style={{ borderColor: accent }}>
      <Handle type="target" position={Position.Top} />
      <div className="je-node__row">
        <div className="je-node__icon" style={{ background: accent }}>{icon}</div>
        <div className="je-node__text">
          <div className="je-node__label">{data.displayName}</div>
          <div className="je-node__subtitle">{subtitle}</div>
        </div>
      </div>
      <Handle type="source" position={Position.Bottom} id="default" />
      <Handle
        type="source"
        position={Position.Right}
        id="error"
        style={{ background: "#ff7675", border: "2px solid #1a1a24" }}
        title="Error output"
      />
    </div>
  );
}
