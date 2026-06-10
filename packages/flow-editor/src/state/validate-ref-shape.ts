import type { WorkflowGraph, Shape } from "@journeyman/core";
import { resolveShape, shapeAtPathSegs, parsePathSegments, shapesCompatible, getStartWorkflowInputs, workflowInputDefShape } from "@journeyman/core";
import type { StepCatalogEntry } from "../catalogs/use-step-catalog.ts";

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
  const segs = parsePathSegments(fieldPath);
  if (!segs || segs.length === 0 || segs[0].kind !== "key") return { ok: false, error: `Invalid path '${ref}'` };
  const head = segs[0].key;
  const tail = segs.slice(1);

  let root: Shape | undefined;
  if (source === "workflow") {
    const decls = (flow.inputDefs && flow.inputDefs.length > 0)
      ? flow.inputDefs
      : getStartWorkflowInputs(
          flow.nodes.find(n => n.type === "trigger-manual" || n.type === "trigger-webhook" || n.type === "trigger-human")?.config,
        );
    const decl = decls.find(r => r.name === head);
    if (!decl) return { ok: false, error: `workflow.input.${head} not declared` };
    root = workflowInputDefShape(decl);
    const leaf = shapeAtPathSegs(root, tail);
    if (!leaf) return { ok: false, error: `Path '${ref}' not found` };
    try {
      return shapesCompatible(leaf, expected) ? { ok: true } : { ok: false, error: `Shape mismatch on '${ref}'` };
    } catch (e) {
      return { ok: false, error: `Shape comparison failed: ${(e as Error).message}` };
    }
  }

  const node = flow.nodes.find(n => n.id === source);
  if (!node || node.type !== "step" || !node.stepType) return { ok: false, error: `Bad node '${source}'` };
  const entry = catalog[node.stepType];
  root = scope === "output" ? entry?.outputSchema?.[head] : entry?.inputFields?.[head]?.shape;
  if (!root) return { ok: false, error: `Field '${scope}.${head}' not on '${source}'` };

  const leaf = shapeAtPathSegs(root, tail);
  if (!leaf) return { ok: false, error: `Path '${ref}' not found` };
  try {
    return shapesCompatible(resolveShape(leaf), expected) ? { ok: true } : { ok: false, error: `Shape mismatch on '${ref}'` };
  } catch (e) {
    return { ok: false, error: `Shape comparison failed: ${(e as Error).message}` };
  }
}
