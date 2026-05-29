import { useMemo } from "react";
import type { WorkflowGraph, Shape, CustomAiStep } from "@journeyman/core";
import { getStartWorkflowInputs, workflowInputDefShape, workflowAttributeDefShape } from "@journeyman/core";
import { customStepToShape } from "@journeyman/custom-steps/shape-adapter";
import type { StepCatalogEntry } from "../catalogs/use-step-catalog.ts";
import { pauseNodeSource } from "./pause-node-source.ts";
import { joinSource } from "./join-source.ts";

export interface UpstreamField {
  name: string;
  description?: string;
  /** "input" → ${node.input.x} ; "output" → ${node.output.x} ; "run-input" → ${workflow.input.x} ; "workflow-attribute" → ${workflow.attribute.x} */
  scope: "input" | "output" | "run-input" | "workflow-attribute";
  shape: Shape;
}

export interface UpstreamSource {
  kind: "run-input" | "workflow-attribute" | "node";
  /** node id, or "" for run-input / workflow-attribute */
  id: string;
  label: string;
  /** Grouped fields for the picker. */
  groups: { title: string; scope: "input" | "output" | "run-input" | "workflow-attribute"; fields: UpstreamField[] }[];
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

    // Transitive reverse-walk through predecessors. Includes every node
    // reachable backward through edges, regardless of branching topology.
    // For parallel Fork+Join graphs this exposes all branches' nodes;
    // for XOR If/Else the branch siblings also appear (engine returns
    // undefined for refs to branches that didn't run).
    const preds = new Map<string, string[]>();
    for (const e of graph.edges) {
      const arr = preds.get(e.target) ?? [];
      arr.push(e.source);
      preds.set(e.target, arr);
    }
    const seen = new Set<string>();
    const upstream: string[] = [];
    const stack: string[] = [...(preds.get(nodeId) ?? [])];
    while (stack.length) {
      const id = stack.pop()!;
      if (seen.has(id)) continue;
      seen.add(id);
      upstream.push(id);
      for (const p of preds.get(id) ?? []) stack.push(p);
    }

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
            shape: workflowInputDefShape(r),
          })),
        }],
      });
    }
    const attributeDefs = graph.attributeDefs ?? [];
    if (attributeDefs.length) {
      sources.push({
        kind: "workflow-attribute",
        id: "",
        label: "Default attributes",
        groups: [{
          title: "Default attributes",
          scope: "workflow-attribute",
          fields: attributeDefs.map(a => ({
            name: a.name,
            description: a.description,
            scope: "workflow-attribute" as const,
            shape: workflowAttributeDefShape(a),
          })),
        }],
      });
    }
    for (const id of upstream) {
      const n = graph.nodes.find(x => x.id === id);
      if (!n) continue;

      if (n.type === "human-task" || n.type === "webhook-wait") {
        const src = pauseNodeSource(n);
        if (src) sources.push(src);
        continue;
      }

      if (n.type === "join") {
        const src = joinSource(n);
        if (src) sources.push(src);
        continue;
      }

      if (n.type !== "step" || !n.stepType) continue;

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
