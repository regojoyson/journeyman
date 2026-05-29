import type { WorkflowInputValue } from "@journeyman/core";
import { replaceTemplateRefs } from "@journeyman/core";

export function resolveInputs(
  inputs: Record<string, WorkflowInputValue> | null | undefined,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(inputs ?? {})) {
    if (v.kind === "literal") out[k] = v.value;
    else if (v.kind === "ref") out[k] = "${" + toEngineRef(v.ref) + "}";
    else if (v.kind === "template") {
      out[k] = replaceTemplateRefs(v.template, (ref) => "${" + toEngineRef(ref) + "}");
    }
  }
  return out;
}

/**
 * Editor ref → Conductor template path. The engine only resolves the
 * `workflow.input.*` namespace, so attribute refs (`workflow.attribute.x`) are
 * rewritten to the nested `workflow.input.attributes.x` seeded at run-start.
 * All other refs pass through (after markdown-autolink sanitization).
 */
export function toEngineRef(ref: string): string {
  const clean = sanitizeRef(ref);
  if (clean.startsWith("workflow.attribute.")) {
    return "workflow.input.attributes." + clean.slice("workflow.attribute.".length);
  }
  return clean;
}

export type RefScope = "workflow.input" | "workflow.attribute" | "input" | "output";

export interface ParsedRef {
  source: string;
  scope: RefScope;
  field: string;
}

/**
 * Parse a Conductor reference string. Supported forms:
 *   - "workflow.input.X"     → run-input value
 *   - "<nodeId>.input.X"     → upstream step's resolved input
 *   - "<nodeId>.output.X"    → upstream step's output
 */
/**
 * Strip markdown autolink syntax `[text](url)` that some clients introduce when
 * domain-shaped tokens (e.g. `node.output.id`) are pasted into rich-text fields.
 * Repeats until no more link patterns remain so nested/multiple wrappings are handled.
 */
export function sanitizeRef(ref: string): string {
  let out = ref;
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const next = out.replace(/\[([^\]]+)\]\([^)]*\)/g, "$1");
    if (next === out) return next;
    out = next;
  }
}

export function parseRef(ref: string): ParsedRef | null {
  const clean = sanitizeRef(ref);
  if (clean.startsWith("workflow.input.")) {
    return { source: "workflow.input", scope: "workflow.input", field: clean.slice("workflow.input.".length) };
  }
  if (clean.startsWith("workflow.attribute.")) {
    return { source: "workflow.attribute", scope: "workflow.attribute", field: clean.slice("workflow.attribute.".length) };
  }
  const m = /^([^.]+)\.(input|output)\.(.+)$/.exec(clean);
  return m ? { source: m[1], scope: m[2] as RefScope, field: m[3] } : null;
}
