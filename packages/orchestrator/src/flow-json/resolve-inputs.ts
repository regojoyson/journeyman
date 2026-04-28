import type { FlowInputValue } from "@journeyman/core";

export function resolveInputs(
  inputs: Record<string, FlowInputValue> | undefined,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(inputs ?? {})) {
    if (v.kind === "literal") out[k] = v.value;
    else out[k] = "${" + v.ref + "}";
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
export function parseRef(ref: string): ParsedRef | null {
  if (ref.startsWith("workflow.input.")) {
    return { source: "workflow.input", scope: "workflow.input", field: ref.slice("workflow.input.".length) };
  }
  const m = /^([^.]+)\.(input|output)\.(.+)$/.exec(ref);
  return m ? { source: m[1], scope: m[2] as RefScope, field: m[3] } : null;
}
