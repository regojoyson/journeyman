import type { WorkflowInputValue } from "@journeyman/core";
import type { InputIntent } from "./intent.ts";

/** Node ids must not contain a dot — the ref grammar splits on the first dot. */
export function isValidNodeId(id: string): boolean {
  return id.length > 0 && !id.includes(".");
}

/** The editor-form ref string for a single-binding InputIntent, or null if it isn't one. */
export function refString(v: InputIntent): string | null {
  switch (v.from) {
    case "step-output":         return `${v.stepRef}.output.${v.field}`;
    case "workflow-input":      return `workflow.input.${v.name}`;
    case "workflow-attribute":  return `workflow.attribute.${v.name}`;
    default:                    return null;
  }
}

/** Convert an InputIntent into the stored WorkflowInputValue. */
export function toInputValue(v: InputIntent): WorkflowInputValue {
  if (v.from === "literal") return { kind: "literal", value: v.value };
  if (v.from === "template") return { kind: "template", template: v.template };
  const ref = refString(v);
  // refString is non-null for the remaining kinds (step-output / workflow-input / workflow-attribute).
  return { kind: "ref", ref: ref! };
}
