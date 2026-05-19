import type { WorkflowGraph, OutputSchema, Shape, CustomAiStep } from "@journeyman/core";
import { WORKFLOW_INPUT_SUGGESTIONS, resolveShape } from "@journeyman/core";

export interface ConditionSuggestion {
  /** Full var path used in JsonLogic, e.g. "step1.output.score". */
  path: string;
  /** Stable group key — step id, or "Workflow input". */
  group: string;
  /** Display label for the optgroup, e.g. "Analyze Repo · #abc123" or "Workflow input". */
  groupLabel: string;
  /** Display label for the option, e.g. "output.score (number)". */
  fieldLabel: string;
  /** Logical type of the leaf, when known. */
  type?: "string" | "number" | "boolean" | "object" | "array";
}

export interface CatalogLookup {
  outputSchemaFor(stepType: string): OutputSchema | null;
}

/**
 * Build the autosuggest list for a condition LHS attached to an edge that
 * leaves the gateway node identified by `gatewayId`.
 *
 * Walks predecessors backward (transparently through gateway-xor / gateway-and
 * nodes) and emits one entry per leaf field of each reachable step
 * outputSchema, plus the static workflow.input.* entries.
 *
 * `extraSchemas` lets callers inject runtime-fetched schemas (e.g. per-instance
 * custom-ai step outputs that the static registry doesn't know about). When a
 * step id has both a static schema and an extra schema, the extra schema wins
 * only if the static schema is empty.
 */
export function buildConditionSuggestions(
  flow: WorkflowGraph,
  gatewayId: string,
  catalog: CatalogLookup,
  extraSchemas?: Map<string, OutputSchema>,
): ConditionSuggestion[] {
  const stepIds = collectUpstreamSteps(flow, gatewayId);

  const displayNameByStep = new Map<string, string>();
  const displayNameCounts = new Map<string, number>();
  for (const stepId of stepIds) {
    const node = flow.nodes.find(n => n.id === stepId);
    const name = node?.displayName?.trim() || node?.stepType || stepId;
    displayNameByStep.set(stepId, name);
    displayNameCounts.set(name, (displayNameCounts.get(name) ?? 0) + 1);
  }

  const out: ConditionSuggestion[] = [];

  for (const stepId of stepIds) {
    const node = flow.nodes.find(n => n.id === stepId);
    if (!node?.stepType) continue;
    const staticSchema = catalog.outputSchemaFor(node.stepType);
    const extra = extraSchemas?.get(stepId);
    const schema =
      extra && (!staticSchema || Object.keys(staticSchema).length === 0)
        ? extra
        : staticSchema;
    if (!schema) continue;

    const displayName = displayNameByStep.get(stepId) ?? stepId;
    const ambiguous = (displayNameCounts.get(displayName) ?? 0) > 1
      || displayName === stepId;
    const groupLabel = ambiguous
      ? `${displayName} · #${stepId.slice(-6)}`
      : displayName;

    for (const leaf of flattenOutputSchema(schema)) {
      const typeSuffix = leaf.type ? ` (${leaf.type})` : "";
      out.push({
        path: `${stepId}.output.${leaf.path}`,
        group: stepId,
        groupLabel,
        fieldLabel: `output.${leaf.path}${typeSuffix}`,
        type: leaf.type,
      });
    }
  }

  for (const w of WORKFLOW_INPUT_SUGGESTIONS) {
    const typeSuffix = w.type ? ` (${w.type})` : "";
    out.push({
      path: w.path,
      group: "Workflow input",
      groupLabel: "Workflow input",
      fieldLabel: `${w.path}${typeSuffix}`,
      type: w.type,
    });
  }

  return out;
}

export function collectUpstreamSteps(flow: WorkflowGraph, gatewayId: string): string[] {
  const incoming = new Map<string, string[]>();
  for (const e of flow.edges) {
    const arr = incoming.get(e.target) ?? [];
    arr.push(e.source);
    incoming.set(e.target, arr);
  }

  const seen = new Set<string>();
  const steps: string[] = [];
  const stack = [...(incoming.get(gatewayId) ?? [])];
  while (stack.length) {
    const id = stack.pop()!;
    if (seen.has(id)) continue;
    seen.add(id);
    const node = flow.nodes.find(n => n.id === id);
    if (!node) continue;
    if (node.type === "step") steps.push(id);
    for (const pred of incoming.get(id) ?? []) stack.push(pred);
  }
  return steps.reverse();
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

/**
 * Convert a `CustomAiStep` (whose `outputSchema` is a JSON Schema fragment)
 * into the editor's `OutputSchema` shape. Mirrors the conversion in
 * packages/web/src/flow-editor-integration/useCustomStepPaletteEntries.ts —
 * inlined here to keep flow-editor independent of the web package.
 */
export function customAiOutputSchemaFromJsonSchema(p: CustomAiStep): OutputSchema {
  if (p.outputMode === "text") {
    return { result: { type: "string" } } as OutputSchema;
  }
  if (p.outputMode === "structured" && p.outputSchema) {
    const props = (p.outputSchema as { properties?: Record<string, { type?: Shape["type"]; description?: string }> }).properties ?? {};
    return Object.fromEntries(
      Object.entries(props).map(([k, v]) => [
        k,
        { type: (v?.type ?? "string"), ...(v?.description ? { description: v.description } : {}) },
      ]),
    ) as OutputSchema;
  }
  return {} as OutputSchema;
}
