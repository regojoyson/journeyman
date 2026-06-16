// packages/flow-editor/src/canvas/nodes/StepNode.tsx
import { useMemo } from "react";
import { Handle, Position, useStore, type NodeProps } from "@xyflow/react";
import { handleBlue, handleRed } from "../handle-styles.ts";
import { useStepRegistry } from "../../state/step-registry-context.tsx";
import { NodeIssueBadges } from "./NodeIssueBadges.tsx";
import { useCustomStepDefs } from "../../catalogs/use-custom-step-defs.ts";
import { resolveStepIcon } from "../../icons/resolve.tsx";
import type { StepRunState } from "../../step-definition.ts";

export interface StepNodeData {
  displayName: string;
  stepType: string;
  config?: Record<string, unknown>;
  inputs?: Record<string, { kind: string; ref?: string; value?: unknown } | undefined>;
  runState?: StepRunState;
  [key: string]: unknown;
}

const STATUS_COLORS: Record<StepRunState["status"], string> = {
  idle:      "rgb(var(--color-text-muted) / 1)",
  running:   "rgb(var(--color-info) / 1)",
  succeeded: "rgb(var(--color-success) / 1)",
  failed:    "rgb(var(--color-danger) / 1)",
};

function DefaultStatusBadge({ state }: { state: StepRunState }) {
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

export function StepNode(props: NodeProps) {
  const data = props.data as StepNodeData;
  const registry = useStepRegistry();
  const definition = registry.get(data.stepType);

  // For custom-ai nodes, the per-instance icon/color lives on the
  // CustomAiStep row (looked up by config.customStepId), not on the
  // built-in custom-ai StepDefinition.
  const customStepId =
    data.stepType === "custom-ai"
      ? ((data.config as { customStepId?: unknown } | undefined)?.customStepId)
      : undefined;
  const customIds = useMemo(
    () => (typeof customStepId === "string" && customStepId ? [customStepId] : []),
    [customStepId],
  );
  const customDefs = useCustomStepDefs(customIds);
  const customDef =
    typeof customStepId === "string" && customStepId ? customDefs[customStepId] : null;

  const accent = customDef ? "rgb(var(--color-accent) / 1)" : (definition?.color ?? "rgb(var(--color-accent) / 1)");
  const rawIcon = customDef ? (customDef.icon ?? null) : (definition?.icon ?? "⚙");
  const icon = resolveStepIcon(rawIcon, { size: 16 });
  const subtitle =
    (customDef && customDef.name) ||
    (definition?.summary && definition.summary(data.config ?? {}, { inputs: data.inputs })) ||
    definition?.label ||
    data.stepType;
  const Badge = definition?.StatusBadge ?? DefaultStatusBadge;
  const isMultiOut = useStore((s) => {
    let count = 0;
    for (const e of s.edges) {
      if (e.source !== props.id) continue;
      const t = (e as { type?: string }).type ?? "default";
      if (t === "default") count++;
      if (count >= 2) return true;
    }
    return false;
  });

  return (
    <div className="je-node je-node--step" style={{ borderColor: accent, position: "relative" }}>
      {data.runState && <Badge state={data.runState} />}
      <NodeIssueBadges nodeId={props.id} />
      {isMultiOut && <span className="je-node-fork-dot" aria-hidden title="This step fans out — branches must converge on a Join">⫶</span>}
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
