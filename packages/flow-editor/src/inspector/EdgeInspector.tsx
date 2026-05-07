import { useMemo } from "react";
import type { WorkflowEdge, WorkflowGraph, JsonLogicExpr } from "@journeyman/core";
import { ConditionBuilder } from "./ConditionBuilder.tsx";
import { buildConditionSuggestions } from "./condition-suggestions.ts";
import { usePhaseRegistry } from "../state/phase-registry-context.tsx";

interface Props {
  flow: WorkflowGraph;
  edge: WorkflowEdge;
  onChange: (next: WorkflowEdge) => void;
}

export function EdgeInspector({ flow, edge, onChange }: Props) {
  const registry = usePhaseRegistry();
  const catalog = useMemo(
    () => ({
      outputSchemaFor: (phaseType: string) => registry.get(phaseType)?.outputSchema ?? null,
    }),
    [registry],
  );

  const sourceNode = flow.nodes.find(n => n.id === edge.source);
  const isXor = sourceNode?.type === "gateway-xor" || sourceNode?.type === "if";

  const suggestions = useMemo(
    () => isXor ? buildConditionSuggestions(flow, edge.source, catalog) : [],
    [flow, edge.source, catalog, isXor],
  );

  if (!isXor) {
    return (
      <div className="je-edge-inspector">
        <div className="je-edge-inspector__hint">
          This edge type has no editable properties.
        </div>
      </div>
    );
  }

  const type = edge.type ?? "default";
  const isConditional = type === "conditional";
  const isElse        = type === "else";

  return (
    <div className="je-edge-inspector">
      <div className="je-edge-inspector__header">
        Edge: {edge.source} → {edge.target}
      </div>

      <label className="je-edge-inspector__field">
        <span>Branch label</span>
        <input
          type="text"
          value={edge.branchLabel ?? ""}
          onChange={(e) => onChange({ ...edge, branchLabel: e.target.value })}
          disabled={isElse}
        />
      </label>

      <fieldset className="je-edge-inspector__type">
        <legend>Type</legend>
        <label>
          <input
            type="radio"
            name="edgeType"
            checked={isConditional}
            onChange={() => onChange({ ...edge, type: "conditional" })}
          />
          conditional
        </label>
        <label>
          <input
            type="radio"
            name="edgeType"
            checked={isElse}
            onChange={() => onChange({ ...edge, type: "else", condition: undefined, branchLabel: undefined })}
          />
          else
        </label>
      </fieldset>

      {isConditional && (
        <div className="je-edge-inspector__condition">
          <div className="je-edge-inspector__condition-header">Condition</div>
          <ConditionBuilder
            value={edge.condition}
            suggestions={suggestions}
            onChange={(expr: JsonLogicExpr | undefined) => onChange({ ...edge, condition: expr })}
          />
        </div>
      )}

      {!edge.branchLabel && isConditional && (
        <div className="je-edge-inspector__error">Branch label required.</div>
      )}
    </div>
  );
}
