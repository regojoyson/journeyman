import type { WorkflowInputValue } from "@journeyman/core";

export function resolveInputs(
  inputs: Record<string, WorkflowInputValue> | null | undefined,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(inputs ?? {})) {
    if (v.kind === "literal") out[k] = v.value;
    else if (v.kind === "ref") out[k] = "${" + sanitizeRef(v.ref) + "}";
  }
  return out;
}

export type RefScope = "workflow.input" | "input" | "output";

export interface ParsedRef {
  source: string;
  scope: RefScope;
  field: string;
}

/**
 * Parse a Conductor reference string. Supported forms:
 *   - "workflow.input.X"     → run-input value
 *   - "<nodeId>.input.X"     → upstream phase's resolved input
 *   - "<nodeId>.output.X"    → upstream phase's output
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
  const m = /^([^.]+)\.(input|output)\.(.+)$/.exec(clean);
  return m ? { source: m[1], scope: m[2] as RefScope, field: m[3] } : null;
}
