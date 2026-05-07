import type { WorkflowGraph, OutputSchema, Shape } from "@journeyman/core";
import { WORKFLOW_INPUT_SUGGESTIONS, resolveShape } from "@journeyman/core";

export interface ConditionSuggestion {
  /** Full var path used in JsonLogic, e.g. "phase1.output.score". */
  path: string;
  /** Display group: phase id, or "Workflow input". */
  group: string;
  /** Logical type of the leaf, when known. */
  type?: "string" | "number" | "boolean" | "object" | "array";
}

export interface CatalogLookup {
  outputSchemaFor(phaseType: string): OutputSchema | null;
}

/**
 * Build the autosuggest list for a condition LHS attached to an edge that
 * leaves the gateway node identified by `gatewayId`.
 *
 * Walks predecessors backward (transparently through gateway-xor / gateway-and
 * nodes) and emits one entry per leaf field of each reachable phase's
 * outputSchema, plus the static workflow.input.* entries.
 */
export function buildConditionSuggestions(
  flow: WorkflowGraph,
  gatewayId: string,
  catalog: CatalogLookup,
): ConditionSuggestion[] {
  const phaseIds = collectUpstreamPhases(flow, gatewayId);

  const out: ConditionSuggestion[] = [];

  for (const phaseId of phaseIds) {
    const node = flow.nodes.find(n => n.id === phaseId);
    if (!node?.phaseType) continue;
    const schema = catalog.outputSchemaFor(node.phaseType);
    if (!schema) continue;
    for (const leaf of flattenOutputSchema(schema)) {
      out.push({
        path: `${phaseId}.output.${leaf.path}`,
        group: phaseId,
        type: leaf.type,
      });
    }
  }

  for (const w of WORKFLOW_INPUT_SUGGESTIONS) {
    out.push({ path: w.path, group: "Workflow input", type: w.type });
  }

  return out;
}

function collectUpstreamPhases(flow: WorkflowGraph, gatewayId: string): string[] {
  const incoming = new Map<string, string[]>();
  for (const e of flow.edges) {
    const arr = incoming.get(e.target) ?? [];
    arr.push(e.source);
    incoming.set(e.target, arr);
  }

  const seen = new Set<string>();
  const phases: string[] = [];
  const stack = [...(incoming.get(gatewayId) ?? [])];
  while (stack.length) {
    const id = stack.pop()!;
    if (seen.has(id)) continue;
    seen.add(id);
    const node = flow.nodes.find(n => n.id === id);
    if (!node) continue;
    if (node.type === "phase") phases.push(id);
    for (const pred of incoming.get(id) ?? []) stack.push(pred);
  }
  return phases.reverse();
}

interface Leaf {
  path: string;
  type?: ConditionSuggestion["type"];
}

function flattenOutputSchema(schema: OutputSchema): Leaf[] {
  const leaves: Leaf[] = [];
  for (const [field, shape] of Object.entries(schema)) {
    leaves.push(...flattenShape(shape, field));
  }
  return leaves;
}

function flattenShape(shape: Shape, prefix: string): Leaf[] {
  const resolved = resolveShape(shape);
  if (resolved.type === "object") {
    const out: Leaf[] = [];
    for (const [k, sub] of Object.entries(resolved.fields)) {
      out.push(...flattenShape(sub, `${prefix}.${k}`));
    }
    if (out.length === 0) return [{ path: prefix, type: "object" }];
    return out;
  }
  if (resolved.type === "array") {
    return [{ path: prefix, type: "array" }];
  }
  if (resolved.type === "ref") {
    return [{ path: prefix }];
  }
  return [{ path: prefix, type: resolved.type }];
}
