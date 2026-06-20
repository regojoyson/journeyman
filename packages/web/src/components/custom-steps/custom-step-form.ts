import type { CustomAiStep, CustomAiStepUpdateInput } from "@journeyman/core";
import type { SectionId } from "./CustomStepSectionNav.tsx";

/** Badge label shown in the header: "ENABLED" or "DRAFT". */
export function statusLabel(step: CustomAiStep): string {
  return step.enabled ? "ENABLED" : "DRAFT";
}

/** Which CustomAiStep fields each saveable section owns. */
const SECTION_FIELDS: Partial<Record<SectionId, readonly (keyof CustomAiStep)[]>> = {
  prompt:     ["promptTemplate"],
  definition: ["name", "description", "icon"],
  inputs:     ["inputFields"],
  output:     ["outputMode", "outputFields"],
  tools:      ["defaultTools", "defaultMcpIds", "defaultSkillIds", "requiresSkills", "requiresMcp"],
  secrets:    ["slots"],
};

/** Section IDs that have a Save button (delete has none). */
export const SAVEABLE_SECTION_IDS: readonly SectionId[] = [
  "prompt", "definition", "inputs", "output", "tools", "secrets",
];

/** True when any field the section owns has changed from original to current. */
export function isSectionDirty(
  original: CustomAiStep,
  current: CustomAiStep,
  section: SectionId,
): boolean {
  const fields = SECTION_FIELDS[section] ?? [];
  return fields.some((f) => JSON.stringify(original[f]) !== JSON.stringify(current[f]));
}

/** True when ANY saveable field has changed (used to guard enable). */
export function isStepDirty(original: CustomAiStep, current: CustomAiStep): boolean {
  return SAVEABLE_SECTION_IDS.some((id) => isSectionDirty(original, current, id));
}

/** Build a partial update payload containing only a section's owned fields. */
export function buildSectionUpdateInput(
  step: CustomAiStep,
  section: SectionId,
): CustomAiStepUpdateInput {
  const fields = SECTION_FIELDS[section] ?? [];
  return Object.fromEntries(fields.map((f) => [f, step[f]])) as CustomAiStepUpdateInput;
}
