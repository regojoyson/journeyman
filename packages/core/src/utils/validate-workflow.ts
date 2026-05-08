import type { WorkflowGraph, WorkflowNode, WorkflowSaveWarning, WorkflowInputValue, WorkflowInputDef } from "../types/flow.types.ts";
import type { Shape, OutputSchema } from "../types/shape.types.ts";
import { resolveShape, shapeAtPath, shapesEqual } from "../types/shapes.ts";
import { getStartWorkflowInputs } from "./start-node.ts";

/**
 * Catalog entry the validator needs. The flow-editor and any future server-side
 * caller is responsible for constructing this from whatever source they have.
 */
export interface ValidationCatalogEntry {
  inputFields?: Record<string, { shape: Shape; required?: boolean }>;
  outputSchema?: OutputSchema | null;
}
export type ValidationCatalog = Record<string /* phaseType */, ValidationCatalogEntry>;

/** Per-binding compatibility check used by both the picker and the whole-flow walker. */
export type BindingCheck =
  | { ok: true }
  | { ok: false; reason: "shape-mismatch"; expected: Shape; actual: Shape }
  | { ok: false; reason: "unknown-shape" };

/** Render-friendly tag for a Shape, e.g. "Repo[]" or "Issue". */
export function shapeTag(s: Shape): string {
  switch (s.type) {
    case "string":
    case "number":
    case "boolean": return s.type;
    case "ref":     return s.name;
    case "object":  return s.named ?? "object";
    case "array":   return `${shapeTag(s.items)}[]`;
  }
}

/**
 * Compare a producer's resolved leaf shape against the consumer's declared
 * input shape. `actual === undefined` is treated as the unknown-shape escape
 * hatch so callers can choose to allow it without triggering a warning.
 */
export function validateInputBinding(expected: Shape, actual: Shape | undefined): BindingCheck {
  if (!actual) return { ok: false, reason: "unknown-shape" };
  try {
    if (shapesEqual(actual, expected)) return { ok: true };
  } catch {
    return { ok: false, reason: "unknown-shape" };
  }
  return { ok: false, reason: "shape-mismatch", expected, actual };
}

type RefScope = "workflow.input" | "input" | "output";
interface ParsedRef {
  source: string;
  scope: RefScope;
  fieldPath: string[];
}

function parseRefForValidation(ref: string): ParsedRef | null {
  const trimmed = ref.trim();
  if (trimmed.length === 0) return null;
  if (trimmed.startsWith("workflow.input.")) {
    const rest = trimmed.slice("workflow.input.".length);
    return { source: "workflow.input", scope: "workflow.input", fieldPath: rest.split(".") };
  }
  const m = /^([^.]+)\.(input|output)\.(.+)$/.exec(trimmed);
  if (!m) return null;
  return { source: m[1], scope: m[2] as RefScope, fieldPath: m[3].split(".") };
}

void resolveShape;

function workflowInputShape(def: WorkflowInputDef): Shape | undefined {
  switch (def.type) {
    case "string":  return { type: "string" };
    case "number":  return { type: "number" };
    case "boolean": return { type: "boolean" };
    case "json":    return undefined;
    default:        return undefined;
  }
}

function findStartWorkflowInputs(flow: WorkflowGraph): WorkflowInputDef[] {
  const start = flow.nodes.find((n) => n.type === "start");
  return getStartWorkflowInputs(start?.config);
}

/**
 * Walk every phase node in `flow`, check each input against its catalog
 * declaration, and collect non-blocking WorkflowSaveWarning entries describing:
 *   - shape-mismatch: a ref whose upstream shape doesn't match the input
 *   - missing-required: a required input with no Config value and no ref
 *   - dangling-ref-node: a ref pointing to a deleted upstream node
 *   - dangling-ref-path: a ref whose path does not exist on the source's output
 *   - missing-input-shape: catalog declared this input but didn't give a shape
 *
 * Pure function. No I/O. Memoize at the caller if hot.
 */
export function validateWorkflowInputs(
  flow: WorkflowGraph,
  catalog: ValidationCatalog,
): WorkflowSaveWarning[] {
  const warnings: WorkflowSaveWarning[] = [];
  const nodesById = new Map<string, WorkflowNode>();
  for (const n of flow.nodes) nodesById.set(n.id, n);
  const workflowInputs = findStartWorkflowInputs(flow);
  const workflowInputByName = new Map(workflowInputs.map((r) => [r.name, r] as const));

  for (const node of flow.nodes) {
    if (node.type !== "phase" || !node.phaseType) continue;
    const entry = catalog[node.phaseType];
    if (!entry?.inputFields) continue;

    const config = (node.config ?? {}) as Record<string, unknown>;
    const inputs = (node.inputs ?? {}) as Record<string, WorkflowInputValue>;

    for (const [key, fieldDef] of Object.entries(entry.inputFields)) {
      const expected = fieldDef.shape;
      const inputValue = inputs[key];
      const configValue = config[key];

      if (!expected) {
        warnings.push({
          code: "missing-input-shape",
          message: `${node.id}.${key}: input has no declared shape — fix the phase catalog`,
          nodeId: node.id,
          inputKey: key,
        });
        continue;
      }

      const hasConfigValue = configValue !== undefined && configValue !== "" && configValue !== null;
      const hasRef = inputValue?.kind === "ref" && typeof inputValue.ref === "string" && inputValue.ref.trim().length > 0;
      const hasLiteral = inputValue?.kind === "literal" && inputValue.value !== undefined;

      if (!hasConfigValue && !hasRef && !hasLiteral) {
        if (fieldDef.required) {
          warnings.push({
            code: "missing-required",
            message: `${node.id}: required input '${key}' has no value (type a Config value or bind from upstream)`,
            nodeId: node.id,
            inputKey: key,
          });
        }
        continue;
      }

      if (!hasRef) continue;
      const ref = inputValue!.kind === "ref" ? inputValue!.ref : "";
      const parsed = parseRefForValidation(ref);
      if (!parsed) {
        warnings.push({
          code: "dangling-ref-path",
          message: `${node.id}.${key}: ref '${ref}' is malformed`,
          nodeId: node.id,
          inputKey: key,
          ref,
          missingPath: ref,
        });
        continue;
      }

      let actual: Shape | undefined;
      if (parsed.scope === "workflow.input") {
        const def = workflowInputByName.get(parsed.fieldPath[0]);
        if (!def) {
          warnings.push({
            code: "dangling-ref-path",
            message: `${node.id}.${key}: ref '${ref}' points to undeclared run input '${parsed.fieldPath[0]}'`,
            nodeId: node.id,
            inputKey: key,
            ref,
            missingPath: parsed.fieldPath.join("."),
          });
          continue;
        }
        const root = workflowInputShape(def);
        actual = root ? (parsed.fieldPath.length > 1 ? shapeAtPath(root, parsed.fieldPath.slice(1)) ?? undefined : root) : undefined;
      } else {
        const sourceNode = nodesById.get(parsed.source);
        if (!sourceNode) {
          warnings.push({
            code: "dangling-ref-node",
            message: `${node.id}.${key}: ref '${ref}' points to unknown node '${parsed.source}'`,
            nodeId: node.id,
            inputKey: key,
            ref,
            missingNodeId: parsed.source,
          });
          continue;
        }
        if (parsed.scope === "input") continue;
        if (sourceNode.type !== "phase" || !sourceNode.phaseType) continue;
        const sourceEntry = catalog[sourceNode.phaseType];
        const outputSchema = sourceEntry?.outputSchema;
        if (!outputSchema) continue;
        const root = outputSchema[parsed.fieldPath[0]];
        if (!root) {
          warnings.push({
            code: "dangling-ref-path",
            message: `${node.id}.${key}: ref '${ref}' points to '${parsed.fieldPath[0]}' which is not in the source's output schema`,
            nodeId: node.id,
            inputKey: key,
            ref,
            missingPath: parsed.fieldPath.join("."),
          });
          continue;
        }
        actual = shapeAtPath(root, parsed.fieldPath.slice(1)) ?? undefined;
        if (!actual) {
          warnings.push({
            code: "dangling-ref-path",
            message: `${node.id}.${key}: ref '${ref}' path does not resolve on the source's output`,
            nodeId: node.id,
            inputKey: key,
            ref,
            missingPath: parsed.fieldPath.join("."),
          });
          continue;
        }
      }

      const check = validateInputBinding(expected, actual);
      if (!check.ok && check.reason === "shape-mismatch") {
        warnings.push({
          code: "shape-mismatch",
          message: `${node.id}.${key}: expected ${shapeTag(expected)}, got ${shapeTag(actual!)} from ${ref}`,
          nodeId: node.id,
          inputKey: key,
          ref,
          expected: shapeTag(expected),
          actual: shapeTag(actual!),
        });
      }
    }
  }

  return warnings;
}
