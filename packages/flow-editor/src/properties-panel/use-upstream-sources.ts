import { useMemo } from "react";
import type { WorkflowGraph, Shape, CustomAiStep } from "@journeyman/core";
import { getStartWorkflowInputs } from "@journeyman/core";
import { customStepToShape } from "@journeyman/custom-steps/shape-adapter";
import type { StepCatalogEntry } from "../catalogs/use-step-catalog.ts";

export interface UpstreamField {
  name: string;
  description?: string;
  /** "input" → emit ${node.input.x} ; "output" → emit ${node.output.x} ; "run-input" → ${workflow.input.x} */
  scope: "input" | "output" | "run-input";
  shape: Shape;
}

export interface UpstreamSource {
  kind: "run-input" | "node";
  /** node id, or "" for run-input */
  id: string;
  label: string;
  /** Grouped fields for the picker. */
  groups: { title: string; scope: "input" | "output" | "run-input"; fields: UpstreamField[] }[];
}

/** Reverse-walks graph from `nodeId`; returns sources reachable on every path (dominators only). */
export function useUpstreamSources(
  graph: WorkflowGraph,
  nodeId: string,
  catalog: Record<string, StepCatalogEntry>,
  customStepDefs?: Record<string, CustomAiStep | null>,
): UpstreamSource[] {
  return useMemo(() => {
    const _t0 = performance.now();
    const startNode = graph.nodes.find(n =>
      n.type === "trigger-manual" || n.type === "trigger-webhook" || n.type === "trigger-human",
    );
    const runInputs = (graph.inputDefs && graph.inputDefs.length > 0)
      ? graph.inputDefs
      : getStartWorkflowInputs(startNode?.config);

    const allIds = new Set(graph.nodes.map(n => n.id));
    const start = startNode?.id;
    const dom = new Map<string, Set<string>>();
    for (const id of allIds) dom.set(id, id === start ? new Set([start!]) : new Set(allIds));
    const preds = new Map<string, string[]>();
    for (const id of allIds) preds.set(id, []);
    for (const e of graph.edges) preds.get(e.target)?.push(e.source);
    let changed = true;
    while (changed) {
      changed = false;
      for (const id of allIds) {
        if (id === start) continue;
        const p = preds.get(id) ?? [];
        if (!p.length) continue;
        const inter = p.map(x => dom.get(x) ?? new Set<string>()).reduce((a, b) => new Set([...a].filter(x => b.has(x))));
        inter.add(id);
        const prev = dom.get(id)!;
        if (prev.size !== inter.size || [...inter].some(x => !prev.has(x))) { dom.set(id, inter); changed = true; }
      }
    }
    const upstream = [...(dom.get(nodeId) ?? new Set())].filter(id => id !== nodeId);

    const sources: UpstreamSource[] = [];
    if (runInputs.length) {
      sources.push({
        kind: "run-input",
        id: "",
        label: "Run inputs",
        groups: [{
          title: "Run inputs",
          scope: "run-input",
          fields: runInputs.map(r => ({
            name: r.name,
            description: r.description,
            scope: "run-input" as const,
            shape: (r.type === "number" || r.type === "boolean" || r.type === "string"
              ? { type: r.type }
              : { type: "string" }) as Shape,
          })),
        }],
      });
    }
    for (const id of upstream) {
      const n = graph.nodes.find(x => x.id === id);
      if (!n || n.type !== "step" || !n.stepType) continue;

      let inputFields: StepCatalogEntry["inputFields"] = {};
      let outputSchema: StepCatalogEntry["outputSchema"] = {};

      if (n.stepType === "custom-ai") {
        const customId = (n.config as { customStepId?: unknown } | undefined)?.customStepId;
        if (typeof customId !== "string" || !customId) continue;
        const def = customStepDefs?.[customId];
        if (!def) continue;
        const shape = customStepToShape(def);
        inputFields = shape.inputFields;
        outputSchema = shape.outputSchema ?? {};
      } else {
        const entry = catalog[n.stepType];
        inputFields = entry?.inputFields ?? {};
        outputSchema = entry?.outputSchema ?? {};
      }

      const groups: UpstreamSource["groups"] = [];
      const inputEntries = Object.entries(inputFields);
      if (inputEntries.length) {
        groups.push({
          title: "Inputs",
          scope: "input",
          fields: inputEntries.map(([name, meta]) => ({
            name,
            description: meta.label,
            scope: "input",
            shape: meta.shape,
          })),
        });
      }
      const outputEntries = Object.entries(outputSchema);
      if (outputEntries.length) {
        groups.push({
          title: "Outputs",
          scope: "output",
          fields: outputEntries.map(([name, s]) => ({
            name,
            description: (s as { description?: string }).description,
            scope: "output",
            shape: s as Shape,
          })),
        });
      }

      sources.push({
        kind: "node",
        id,
        label: n.displayName ?? n.stepType,
        groups,
      });
    }
    const _ms = performance.now() - _t0;
    if (_ms > 50) {
      // eslint-disable-next-line no-console
      console.warn(
        `[flow-editor] useUpstreamSources slow: ${_ms.toFixed(1)}ms`,
        { nodes: graph.nodes.length, edges: graph.edges.length, nodeId },
      );
    }
    return sources;
  }, [graph, nodeId, catalog, customStepDefs]);
}

export function collectCustomStepIds(graph: WorkflowGraph): string[] {
  const set = new Set<string>();
  for (const n of graph.nodes) {
    if (n.type !== "step" || n.stepType !== "custom-ai") continue;
    const id = (n.config as { customStepId?: unknown } | undefined)?.customStepId;
    if (typeof id === "string" && id) set.add(id);
  }
  return [...set];
}
