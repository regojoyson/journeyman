import { useEffect, useMemo, useState } from "react";
import type { WorkflowEdge, WorkflowGraph, JsonLogicExpr, CustomAiStep } from "@journeyman/core";
import { ConditionBuilder } from "./ConditionBuilder.tsx";
import { useStepCatalog } from "../catalogs/use-step-catalog.ts";
import { useUpstreamSources } from "../properties-panel/use-upstream-sources.ts";
import { useOrgId } from "../state/org-context.tsx";

interface Props {
  flow: WorkflowGraph;
  edge: WorkflowEdge;
  onChange: (next: WorkflowEdge) => void;
  onClose?: () => void;
}

export function EdgeInspector({ flow, edge, onChange, onClose }: Props) {
  const catalog = useStepCatalog();
  const orgId = useOrgId();

  const sourceNode = flow.nodes.find(n => n.id === edge.source);
  const isXor = sourceNode?.type === "gateway-xor" || sourceNode?.type === "if";

  // Collect distinct customStepIds referenced anywhere in the graph by
  // custom-ai nodes — useUpstreamSources only consumes the ones it needs
  // (dominators of edge.source), so over-fetching is cheap and avoids
  // re-running the fetch whenever edge.source changes.
  const customStepIds = useMemo(() => {
    if (!isXor) return [] as string[];
    const set = new Set<string>();
    for (const n of flow.nodes) {
      if (n.type !== "step") continue;
      if (n.stepType !== "custom-ai" && !n.stepType?.startsWith("custom-ai:")) continue;
      const cfg = (n.config ?? {}) as { customStepId?: unknown };
      if (typeof cfg.customStepId === "string" && cfg.customStepId) set.add(cfg.customStepId);
    }
    return [...set];
  }, [flow.nodes, isXor]);

  const customStepKey = customStepIds.slice().sort().join(",");

  const [customStepDefs, setCustomStepDefs] = useState<Record<string, CustomAiStep | null>>({});
  const [loadingCustom, setLoadingCustom] = useState(false);
  const [customErrored, setCustomErrored] = useState(false);

  useEffect(() => {
    if (!isXor || !orgId || customStepIds.length === 0) {
      setCustomStepDefs({});
      setLoadingCustom(false);
      setCustomErrored(false);
      return;
    }
    let alive = true;
    setLoadingCustom(true);
    setCustomErrored(false);

    const fetches = customStepIds.map(async (id): Promise<[string, CustomAiStep | null]> => {
      try {
        let res = await fetch(
          `/api/orgs/${orgId}/users/me/custom-steps/${id}`,
          { credentials: "include" },
        );
        if (!res.ok) {
          res = await fetch(
            `/api/orgs/${orgId}/custom-steps/${id}`,
            { credentials: "include" },
          );
        }
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const step = (await res.json()) as CustomAiStep;
        return [id, step];
      } catch (err) {
        console.warn(`[EdgeInspector] failed to load custom step ${id}:`, err);
        return [id, null];
      }
    });

    Promise.all(fetches).then(results => {
      if (!alive) return;
      const next: Record<string, CustomAiStep | null> = {};
      let anyError = false;
      for (const [id, step] of results) {
        next[id] = step;
        if (!step) anyError = true;
      }
      setCustomStepDefs(next);
      setCustomErrored(anyError);
      setLoadingCustom(false);
    });

    return () => { alive = false; };
  }, [customStepKey, orgId, isXor]);

  const sources = useUpstreamSources(flow, edge.source, catalog, customStepDefs);

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
        <span>Edge: {edge.source} → {edge.target}</span>
        {onClose ? (
          <button type="button" className="je-props__close" onClick={onClose} aria-label="Close">×</button>
        ) : null}
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
          {loadingCustom && (
            <div className="je-edge-inspector__status">Loading custom step outputs…</div>
          )}
          {!loadingCustom && customErrored && (
            <div className="je-edge-inspector__status">(failed to load some custom-step outputs)</div>
          )}
          <ConditionBuilder
            value={edge.condition}
            sources={sources}
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
