import type { FlowGraph, FlowNode, Shape, OutputSchema, InputFields } from "@journeyman/core";
import { resolveShape, shapeAtPath, shapesEqual } from "@journeyman/core";
import { parseRef } from "./resolve-inputs.ts";

/**
 * Minimal catalog-shape used by validation. Compatible with @journeyman/phases'
 * PhaseCatalogEntry — passed in from the caller to avoid an upstream dep.
 */
export interface CatalogShapeEntry {
  phaseType: string;
  inputFields: InputFields;
  outputSchema: OutputSchema | null;
}

interface RefShapeResult {
  ok: boolean;
  shape?: Shape;
  error?: string;
}

export function resolveRefShape(
  flow: FlowGraph,
  ref: string,
  catalog: Map<string, CatalogShapeEntry>,
): RefShapeResult {
  const parsed = parseRef(ref);
  if (!parsed) return { ok: false, error: `Unparseable ref '${ref}'` };

  const path = parsed.field.split(".");

  if (parsed.scope === "workflow.input") {
    const startNode = flow.nodes.find(n => n.type === "start");
    const runInputs = ((startNode?.config as { runInputs?: { name: string; shape?: Shape }[] } | undefined)?.runInputs) ?? [];
    const decl = runInputs.find(r => r.name === path[0]);
    if (!decl) return { ok: false, error: `workflow.input.${path[0]} not declared` };
    const root = decl.shape ?? ({ type: "string" } as Shape);
    const leaf = shapeAtPath(root, path.slice(1));
    return leaf ? { ok: true, shape: leaf } : { ok: false, error: `Path not found: ${ref}` };
  }

  const node = flow.nodes.find(n => n.id === parsed.source);
  if (!node) return { ok: false, error: `Node '${parsed.source}' not found` };
  if (node.type !== "phase" || !node.phaseType) return { ok: false, error: `Node '${parsed.source}' is not a phase` };
  const entry = catalog.get(node.phaseType);
  if (!entry) return { ok: false, error: `Unknown phase type '${node.phaseType}'` };

  const root: Shape | undefined =
    parsed.scope === "output"
      ? entry.outputSchema?.[path[0]]
      : entry.inputFields?.[path[0]]?.shape;
  if (!root) return { ok: false, error: `Field '${parsed.scope}.${path[0]}' not declared on '${parsed.source}'` };

  const leaf = shapeAtPath(root, path.slice(1));
  return leaf ? { ok: true, shape: leaf } : { ok: false, error: `Path not found: ${ref}` };
}

export function validateRefShapeAgainst(
  flow: FlowGraph,
  ref: string,
  expected: Shape,
  catalog: Map<string, CatalogShapeEntry>,
): { ok: boolean; error?: string } {
  const r = resolveRefShape(flow, ref, catalog);
  if (!r.ok || !r.shape) return { ok: false, error: r.error };
  let ok = false;
  try {
    ok = shapesEqual(r.shape, expected);
  } catch (e) {
    return { ok: false, error: `Shape comparison failed: ${(e as Error).message}` };
  }
  if (!ok) {
    return {
      ok: false,
      error: `Ref '${ref}' resolves to shape ${describeShape(r.shape)} but expected ${describeShape(expected)}`,
    };
  }
  return { ok: true };
}

function describeShape(s: Shape): string {
  let r: Shape;
  try {
    r = resolveShape(s);
  } catch {
    r = s;
  }
  switch (r.type) {
    case "object": return r.named ?? "object";
    case "array":  return `${describeShape(r.items)}[]`;
    case "ref":    return r.name;
    default:       return r.type;
  }
}

export function isPhaseNode(n: FlowNode): n is FlowNode & { type: "phase"; phaseType: string } {
  return n.type === "phase" && !!n.phaseType;
}
