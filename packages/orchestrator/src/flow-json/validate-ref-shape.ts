import type { WorkflowGraph, WorkflowNode, Shape, OutputSchema, InputFields } from "@journeyman/core";
import { resolveShape, shapeAtPath, shapesEqual, getStartWorkflowInputs } from "@journeyman/core";
import { parseRef } from "./resolve-inputs.ts";

/**
 * Minimal catalog-shape used by validation. Compatible with @journeyman/steps'
 * StepCatalogEntry — passed in from the caller to avoid an upstream dep.
 */
export interface CatalogShapeEntry {
  stepType: string;
  inputFields: InputFields;
  outputSchema: OutputSchema | null;
}

/** Shape view of a saved custom step (built via `customStepToShape`). */
export interface CustomStepShapeEntry {
  inputFields: InputFields;
  outputSchema: OutputSchema | null;
}

interface RefShapeResult {
  ok: boolean;
  shape?: Shape;
  error?: string;
}

export function resolveRefShape(
  flow: WorkflowGraph,
  ref: string,
  catalog: Map<string, CatalogShapeEntry>,
  customStepDefs?: Map<string, CustomStepShapeEntry>,
): RefShapeResult {
  const parsed = parseRef(ref);
  if (!parsed) return { ok: false, error: `Unparseable ref '${ref}'` };

  const path = parsed.field.split(".");

  if (parsed.scope === "workflow.input") {
    const startNode = flow.nodes.find(n => n.type === "start");
    const workflowInputs = getStartWorkflowInputs(startNode?.config);
    const decl = workflowInputs.find(r => r.name === path[0]);
    if (!decl) return { ok: false, error: `workflow.input.${path[0]} not declared` };
    const root: Shape =
      decl.type === "number" || decl.type === "boolean" || decl.type === "string"
        ? { type: decl.type }
        : { type: "string" };
    const leaf = shapeAtPath(root, path.slice(1));
    return leaf ? { ok: true, shape: leaf } : { ok: false, error: `Path not found: ${ref}` };
  }

  const node = flow.nodes.find(n => n.id === parsed.source);
  if (!node) return { ok: false, error: `Node ${labelNode(undefined, parsed.source)} not found` };
  if (node.type !== "step" || !node.stepType) return { ok: false, error: `Node ${labelNode(node, parsed.source)} is not a step` };

  let inputFields: InputFields | undefined;
  let outputSchema: OutputSchema | null | undefined;

  if (node.stepType === "custom-ai") {
    const customId = (node.config as { customStepId?: unknown } | undefined)?.customStepId;
    if (typeof customId !== "string" || !customId) {
      return { ok: false, error: `Node ${labelNode(node, parsed.source)} has no customStepId` };
    }
    const def = customStepDefs?.get(customId);
    if (!def) {
      return { ok: false, error: `Custom step definition not loaded for node ${labelNode(node, parsed.source)}` };
    }
    inputFields = def.inputFields;
    outputSchema = def.outputSchema;
  } else {
    const entry = catalog.get(node.stepType);
    if (!entry) return { ok: false, error: `Unknown step type '${node.stepType}'` };
    inputFields = entry.inputFields;
    outputSchema = entry.outputSchema;
  }

  const root: Shape | undefined =
    parsed.scope === "output"
      ? outputSchema?.[path[0]]
      : inputFields?.[path[0]]?.shape;
  if (!root) return { ok: false, error: `Field '${parsed.scope}.${path[0]}' not declared on ${labelNode(node, parsed.source)}` };

  const leaf = shapeAtPath(root, path.slice(1));
  return leaf ? { ok: true, shape: leaf } : { ok: false, error: `Path not found: ${ref}` };
}

export function validateRefShapeAgainst(
  flow: WorkflowGraph,
  ref: string,
  expected: Shape,
  catalog: Map<string, CatalogShapeEntry>,
  customStepDefs?: Map<string, CustomStepShapeEntry>,
): { ok: boolean; error?: string } {
  const r = resolveRefShape(flow, ref, catalog, customStepDefs);
  if (!r.ok || !r.shape) return { ok: false, error: r.error };
  let ok = false;
  try {
    ok = isWildcardMatch(r.shape, expected) || shapesEqual(r.shape, expected);
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

/**
 * Wildcard match: when the *expected* shape is an object with no declared
 * fields (e.g. a custom-step input typed as plain `object`), accept any
 * object as the actual shape. Lets custom steps declare generic object
 * inputs without naming every nested field.
 */
function isWildcardMatch(actual: Shape, expected: Shape): boolean {
  const ra = resolveShape(actual);
  const re = resolveShape(expected);
  if (re.type === "object" && Object.keys(re.fields).length === 0 && ra.type === "object") {
    return true;
  }
  return false;
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

export function isStepNode(n: WorkflowNode): n is WorkflowNode & { type: "step"; stepType: string } {
  return n.type === "step" && !!n.stepType;
}

/**
 * Human-friendly label for a node in error messages.
 * Returns `"'Display Name' (node_id)"` when the node has a displayName,
 * `"'node_id'"` when it doesn't (or when the node is missing from the flow).
 */
export function labelNode(n: WorkflowNode | undefined, fallbackId: string): string {
  const name = n?.displayName?.trim();
  return name ? `'${name}' (${fallbackId})` : `'${fallbackId}'`;
}
