import type { WorkflowGraph, OutputSchema, Shape, CustomAiPhase } from "@journeyman/core";
import { WORKFLOW_INPUT_SUGGESTIONS, resolveShape } from "@journeyman/core";

export interface ConditionSuggestion {
  /** Full var path used in JsonLogic, e.g. "phase1.output.score". */
  path: string;
  /** Stable group key — phase id, or "Workflow input". */
  group: string;
  /** Display label for the optgroup, e.g. "Analyze Repo · #abc123" or "Workflow input". */
  groupLabel: string;
  /** Display label for the option, e.g. "output.score (number)". */
  fieldLabel: string;
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
 *
 * `extraSchemas` lets callers inject runtime-fetched schemas (e.g. per-instance
 * custom-ai phase outputs that the static registry doesn't know about). When a
 * phase id has both a static schema and an extra schema, the extra schema wins
 * only if the static schema is empty.
 */
export function buildConditionSuggestions(
  flow: WorkflowGraph,
  gatewayId: string,
  catalog: CatalogLookup,
  extraSchemas?: Map<string, OutputSchema>,
): ConditionSuggestion[] {
  const phaseIds = collectUpstreamPhases(flow, gatewayId);

  const displayNameByPhase = new Map<string, string>();
  const displayNameCounts = new Map<string, number>();
  for (const phaseId of phaseIds) {
    const node = flow.nodes.find(n => n.id === phaseId);
    const name = node?.displayName?.trim() || node?.phaseType || phaseId;
    displayNameByPhase.set(phaseId, name);
    displayNameCounts.set(name, (displayNameCounts.get(name) ?? 0) + 1);
  }

  const out: ConditionSuggestion[] = [];

  for (const phaseId of phaseIds) {
    const node = flow.nodes.find(n => n.id === phaseId);
    if (!node?.phaseType) continue;
    const staticSchema = catalog.outputSchemaFor(node.phaseType);
    const extra = extraSchemas?.get(phaseId);
    const schema =
      extra && (!staticSchema || Object.keys(staticSchema).length === 0)
        ? extra
        : staticSchema;
    if (!schema) continue;

    const displayName = displayNameByPhase.get(phaseId) ?? phaseId;
    const ambiguous = (displayNameCounts.get(displayName) ?? 0) > 1
      || displayName === phaseId;
    const groupLabel = ambiguous
      ? `${displayName} · #${phaseId.slice(-6)}`
      : displayName;

    for (const leaf of flattenOutputSchema(schema)) {
      const typeSuffix = leaf.type ? ` (${leaf.type})` : "";
      out.push({
        path: `${phaseId}.output.${leaf.path}`,
        group: phaseId,
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

export function collectUpstreamPhases(flow: WorkflowGraph, gatewayId: string): string[] {
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

/**
 * Convert a `CustomAiPhase` (whose `outputSchema` is a JSON Schema fragment)
 * into the editor's `OutputSchema` shape. Mirrors the conversion in
 * packages/web/src/flow-editor-integration/useCustomPhasePaletteEntries.ts —
 * inlined here to keep flow-editor independent of the web package.
 */
export function customAiOutputSchemaFromJsonSchema(p: CustomAiPhase): OutputSchema {
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
