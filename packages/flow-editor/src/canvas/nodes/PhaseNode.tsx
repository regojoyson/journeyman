// packages/flow-editor/src/canvas/nodes/PhaseNode.tsx
import { useMemo } from "react";
import { Handle, Position, type NodeProps } from "@xyflow/react";
import { handleBlue, handleRed } from "../handle-styles.ts";
import { usePhaseRegistry } from "../../state/phase-registry-context.tsx";
import { useNodeHasWarning } from "../../state/validation-context.tsx";
import { useCustomPhaseDefs } from "../../catalogs/use-custom-phase-defs.ts";
import { resolvePhaseIcon } from "../../icons/resolve.tsx";
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

  // For custom-ai nodes, the per-instance icon/color lives on the
  // CustomAiPhase row (looked up by config.customPhaseId), not on the
  // built-in custom-ai PhaseDefinition.
  const customPhaseId =
    data.phaseType === "custom-ai"
      ? ((data.config as { customPhaseId?: unknown } | undefined)?.customPhaseId)
      : undefined;
  const customIds = useMemo(
    () => (typeof customPhaseId === "string" && customPhaseId ? [customPhaseId] : []),
    [customPhaseId],
  );
  const customDefs = useCustomPhaseDefs(customIds);
  const customDef =
    typeof customPhaseId === "string" && customPhaseId ? customDefs[customPhaseId] : null;

  const accent = customDef ? "#a29bfe" : (definition?.color ?? "#6c5ce7");
  const rawIcon = customDef ? (customDef.icon ?? null) : (definition?.icon ?? "⚙");
  const icon = resolvePhaseIcon(rawIcon, { size: 16 });
  const subtitle =
    (customDef && customDef.name) ||
    (definition?.summary && definition.summary(data.config ?? {}, { inputs: data.inputs })) ||
    definition?.label ||
    data.phaseType;
  const Badge = definition?.StatusBadge ?? DefaultStatusBadge;
  const hasWarning = useNodeHasWarning(props.id);

  return (
    <div className="je-node je-node--phase" style={{ borderColor: accent, position: "relative" }}>
      {data.runState && <Badge state={data.runState} />}
      {hasWarning && <span className="je-node-warning-dot" aria-hidden title="Input validation warnings — see topbar Validate panel" />}
      <Handle type="target" position={Position.Left} style={handleBlue} />
      <div className="je-node__row">
        <div className="je-node__icon" style={{ background: accent }}>{icon}</div>
        <div className="je-node__text">
          <div className="je-node__label" title={data.displayName}>{data.displayName}</div>
          <div className="je-node__subtitle" title={typeof subtitle === "string" ? subtitle : undefined}>{subtitle}</div>
        </div>
      </div>
      <Handle type="source" position={Position.Right} id="default" style={handleBlue} />
      <Handle type="source" position={Position.Bottom} id="error" style={handleRed} title="Error output" />
    </div>
  );
}
