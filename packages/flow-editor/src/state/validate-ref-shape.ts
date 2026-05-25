import type { WorkflowGraph, Shape } from "@journeyman/core";
import { resolveShape, shapeAtPath, shapesEqual, getStartWorkflowInputs } from "@journeyman/core";
import type { StepCatalogEntry } from "../catalogs/use-step-catalog.ts";

/**
 * When the *expected* input shape is `object` with no declared fields (custom
 * steps that declare a plain `object` input), accept any object as actual.
 */
function isWildcardMatch(actual: Shape, expected: Shape): boolean {
  const ra = resolveShape(actual);
  const re = resolveShape(expected);
  return re.type === "object" && Object.keys(re.fields).length === 0 && ra.type === "object";
}

function shapeMatches(actual: Shape, expected: Shape): boolean {
  return isWildcardMatch(actual, expected) || shapesEqual(actual, expected);
}

export function validateRefShape(
  flow: WorkflowGraph,
  ref: string,
  expected: Shape,
  catalog: Record<string, StepCatalogEntry>,
): { ok: boolean; error?: string } {
  const m =
    /^([^.]+)\.(input|output)\.(.+)$/.exec(ref)
    || /^(workflow)\.(input)\.(.+)$/.exec(ref);
  if (!m) return { ok: false, error: `Unparseable ref '${ref}'` };
  const [, source, scope, fieldPath] = m;
  const path = fieldPath.split(".");

  let root: Shape | undefined;
  if (source === "workflow") {
    const decls = (flow.inputDefs && flow.inputDefs.length > 0)
      ? flow.inputDefs
      : getStartWorkflowInputs(
          flow.nodes.find(n => n.type === "trigger-manual" || n.type === "trigger-webhook" || n.type === "trigger-human")?.config,
        );
    const decl = decls.find(r => r.name === path[0]);
    root = decl
      ? ((decl.type === "number" || decl.type === "boolean" || decl.type === "string"
          ? { type: decl.type }
          : { type: "string" }) as Shape)
      : ({ type: "string" } as Shape);
    if (!root) return { ok: false, error: `workflow.input.${path[0]} not declared` };
    const leaf = shapeAtPath(root, path.slice(1));
    if (!leaf) return { ok: false, error: `Path '${ref}' not found` };
    try {
      return shapeMatches(leaf, expected) ? { ok: true } : { ok: false, error: `Shape mismatch on '${ref}'` };
    } catch (e) {
      return { ok: false, error: `Shape comparison failed: ${(e as Error).message}` };
    }
  }

  const node = flow.nodes.find(n => n.id === source);
  if (!node || node.type !== "step" || !node.stepType) return { ok: false, error: `Bad node '${source}'` };
  const entry = catalog[node.stepType];
  root = scope === "output" ? entry?.outputSchema?.[path[0]] : entry?.inputFields?.[path[0]]?.shape;
  if (!root) return { ok: false, error: `Field '${scope}.${path[0]}' not on '${source}'` };

  const leaf = shapeAtPath(root, path.slice(1));
  if (!leaf) return { ok: false, error: `Path '${ref}' not found` };
  try {
    return shapeMatches(resolveShape(leaf), expected) ? { ok: true } : { ok: false, error: `Shape mismatch on '${ref}'` };
  } catch (e) {
    return { ok: false, error: `Shape comparison failed: ${(e as Error).message}` };
  }
}
