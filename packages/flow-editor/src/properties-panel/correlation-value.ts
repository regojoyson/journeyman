import type { WorkflowInputValue } from "@journeyman/core";
import { parseTemplate, segmentsToTemplate, type Segment } from "./mention-serialize.ts";

// Correlation templates use {{ref}} (braces) syntax — this matches the worker's
// replaceTemplateRefs() and the conductor resolveInputs() pipeline. Do NOT use the
// ${...} (dollar) syntax that ConfigTab config templates use.
const SYNTAX = "braces" as const;

/** Stored correlation value → editable segments for MentionInput. */
export function correlationValueToSegments(value: WorkflowInputValue | undefined): Segment[] {
  if (!value) return [];
  if (value.kind === "template") return parseTemplate(value.template, SYNTAX);
  if (value.kind === "ref") return [{ kind: "ref", ref: value.ref }];
  return parseTemplate(String(value.value ?? ""), SYNTAX); // literal
}

/** MentionInput segments → stored correlation value (always a braces template). */
export function segmentsToCorrelationValue(segs: Segment[]): WorkflowInputValue {
  return { kind: "template", template: segmentsToTemplate(segs, SYNTAX) };
}
