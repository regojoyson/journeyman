import type { CustomStepInputField, SecretSlotDef } from "@journeyman/core";

/** {{name}} — capture group 1 is the input name. */
export const INPUT_TOKEN = /\{\{([A-Za-z_][A-Za-z0-9_]*)\}\}/g;
/** $NAME — group 1 is the (possibly empty) preceding char, group 2 is the slot name. */
export const SLOT_TOKEN = /(^|[^A-Z0-9_])\$([A-Z][A-Z0-9_]*)/g;

export interface ReferenceAnalysis {
  inputs: Set<string>;
  slots: Set<string>;
  unknownInputs: string[];
  unknownSlots: string[];
}

export function analyzeReferences(
  text: string,
  inputNames: Set<string>,
  slotNames: Set<string>,
): ReferenceAnalysis {
  const inputs = new Set<string>();
  const slots = new Set<string>();
  const unknownInputs: string[] = [];
  const unknownSlots: string[] = [];

  for (const m of text.matchAll(INPUT_TOKEN)) {
    const name = m[1];
    inputs.add(name);
    if (!inputNames.has(name) && !unknownInputs.includes(name)) unknownInputs.push(name);
  }
  for (const m of text.matchAll(SLOT_TOKEN)) {
    const name = m[2];
    slots.add(name);
    if (!slotNames.has(name) && !unknownSlots.includes(name)) unknownSlots.push(name);
  }
  return { inputs, slots, unknownInputs, unknownSlots };
}

/** Set of `name` fields — used to build the "known names" sets. */
export function namesOf(fields: Array<CustomStepInputField | SecretSlotDef>): Set<string> {
  return new Set(fields.map(f => f.name));
}
