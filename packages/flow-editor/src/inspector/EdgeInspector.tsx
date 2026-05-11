import { useEffect, useMemo, useState } from "react";
import type { WorkflowEdge, WorkflowGraph, JsonLogicExpr, OutputSchema, CustomAiPhase } from "@journeyman/core";
import { ConditionBuilder } from "./ConditionBuilder.tsx";
import {
  buildConditionSuggestions,
  collectUpstreamPhases,
  customAiOutputSchemaFromJsonSchema,
} from "./condition-suggestions.ts";
import { usePhaseRegistry } from "../state/phase-registry-context.tsx";
import { useOrgId } from "../state/org-context.tsx";

interface Props {
  flow: WorkflowGraph;
  edge: WorkflowEdge;
  onChange: (next: WorkflowEdge) => void;
}

interface CustomPhaseFetchTarget {
  phaseId: string;
  customPhaseId: string;
}

export function EdgeInspector({ flow, edge, onChange }: Props) {
  const registry = usePhaseRegistry();
  const orgId = useOrgId();
  const catalog = useMemo(
    () => ({
      outputSchemaFor: (phaseType: string) => registry.get(phaseType)?.outputSchema ?? null,
    }),
    [registry],
  );

  const sourceNode = flow.nodes.find(n => n.id === edge.source);
  const isXor = sourceNode?.type === "gateway-xor" || sourceNode?.type === "if";

  const customTargets = useMemo<CustomPhaseFetchTarget[]>(() => {
    if (!isXor) return [];
    const upstream = collectUpstreamPhases(flow, edge.source);
    const targets: CustomPhaseFetchTarget[] = [];
    for (const phaseId of upstream) {
      const node = flow.nodes.find(n => n.id === phaseId);
      if (!node) continue;
      const isCustom = node.phaseType === "custom-ai" || node.phaseType?.startsWith("custom-ai:");
      if (!isCustom) continue;
      const cfg = (node.config ?? {}) as { customPhaseId?: unknown };
      if (typeof cfg.customPhaseId === "string" && cfg.customPhaseId) {
        targets.push({ phaseId, customPhaseId: cfg.customPhaseId });
      }
    }
    return targets;
  }, [flow, edge.source, isXor]);

  const targetsKey = customTargets.map(t => `${t.phaseId}:${t.customPhaseId}`).sort().join(",");

  const [extraSchemas, setExtraSchemas] = useState<Map<string, OutputSchema>>(new Map());
  const [loadingExtras, setLoadingExtras] = useState(false);
  const [extrasErrored, setExtrasErrored] = useState(false);

  useEffect(() => {
    if (!isXor || !orgId || customTargets.length === 0) {
      setExtraSchemas(new Map());
      setLoadingExtras(false);
      setExtrasErrored(false);
      return;
    }
    let alive = true;
    setLoadingExtras(true);
    setExtrasErrored(false);

    const fetches = customTargets.map(async (t): Promise<[string, OutputSchema | null]> => {
      try {
        let res = await fetch(
          `/api/orgs/${orgId}/users/me/custom-phases/${t.customPhaseId}`,
          { credentials: "include" },
        );
        if (!res.ok) {
          res = await fetch(
            `/api/orgs/${orgId}/custom-phases/${t.customPhaseId}`,
            { credentials: "include" },
          );
        }
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const phase = (await res.json()) as CustomAiPhase;
        return [t.phaseId, customAiOutputSchemaFromJsonSchema(phase)];
      } catch (err) {
        console.warn(`[EdgeInspector] failed to load custom phase ${t.customPhaseId}:`, err);
        return [t.phaseId, null];
      }
    });

    Promise.all(fetches).then(results => {
      if (!alive) return;
      const next = new Map<string, OutputSchema>();
      let anyError = false;
      for (const [phaseId, schema] of results) {
        if (schema) next.set(phaseId, schema);
        else anyError = true;
      }
      setExtraSchemas(next);
      setExtrasErrored(anyError);
      setLoadingExtras(false);
    });

    return () => { alive = false; };
  }, [targetsKey, orgId, isXor]);

  const suggestions = useMemo(() => {
    if (!isXor) return [];
    const base = buildConditionSuggestions(flow, edge.source, catalog, extraSchemas);
    if (loadingExtras) {
      base.unshift({
        path: "__loading__",
        group: "__status__",
        groupLabel: "Status",
        fieldLabel: "Loading custom phase outputs…",
      });
    } else if (extrasErrored) {
      base.unshift({
        path: "__error__",
        group: "__status__",
        groupLabel: "Status",
        fieldLabel: "(failed to load some custom-phase outputs)",
      });
    }
    return base;
  }, [flow, edge.source, catalog, extraSchemas, loadingExtras, extrasErrored, isXor]);

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
  const isElse = type === "else";
  const isConditional = !isElse;

  const otherElseCount = flow.edges.filter(
    e => e.source === edge.source && e.id !== edge.id && e.type === "else",
  ).length;
  const showDuplicateElseWarning = isElse && otherElseCount > 0;

  const toggleElse = (next: boolean) => {
    if (next) {
      onChange({ ...edge, type: "else", condition: undefined, branchLabel: undefined });
    } else {
      onChange({ ...edge, type: "conditional" });
    }
  };

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

      <label className="je-edge-inspector__fallback">
        <input
          type="checkbox"
          checked={isElse}
          onChange={(e) => toggleElse(e.target.checked)}
        />
        <span>
          <strong>Mark as fallback (else)</strong>
          <br />
          <small>Taken when no other conditional branch from this gateway matches.</small>
        </span>
      </label>

      {showDuplicateElseWarning && (
        <div className="je-edge-inspector__warning">
          This gateway already has an else branch — only one is allowed at runtime.
        </div>
      )}

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
