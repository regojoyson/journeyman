import type { Completion } from "@codemirror/autocomplete";
import type { CustomStepInputField, SecretSlotDef } from "@journeyman/core";

/** Completions offered after the user types `{{`. The label closes the braces. */
export function buildInputCompletions(fields: CustomStepInputField[]): Completion[] {
  return fields.map(f => ({
    label: `${f.name}}}`,
    displayLabel: f.name,
    type: "variable",
    detail: f.required ? `${f.type} · required` : f.type,
    info: f.description,
  }));
}

/** Completions offered after the user types `$`. */
export function buildSlotCompletions(slots: SecretSlotDef[]): Completion[] {
  return slots.map(s => ({
    label: s.name,
    type: "constant",
    detail: s.optional ? "env · optional" : "env",
    info: s.description,
  }));
}
