import type { CustomAiStep, ProposedCustomStep } from "@journeyman/core";
import { customStepToShape, type CustomStepShape } from "@journeyman/custom-steps/shape-adapter";

/**
 * Build `CustomStepShape` entries for not-yet-persisted proposed steps, keyed by
 * their placeholder id (the value workflow nodes carry in `config.customStepId`).
 * Lets the validate gate resolve refs to brand-new steps before they exist in the DB.
 */
export function shapesFromProposedSteps(
  proposed: ProposedCustomStep[] | undefined,
): Map<string, CustomStepShape> {
  const map = new Map<string, CustomStepShape>();
  if (!proposed) return map;
  for (const p of proposed) {
    // customStepToShape only reads inputFields / outputMode / outputFields.
    const shape = customStepToShape({
      inputFields: p.step.inputFields ?? [],
      outputMode: p.step.outputMode ?? "none",
      outputFields: p.step.outputFields ?? [],
    } as unknown as CustomAiStep);
    map.set(p.id, shape);
  }
  return map;
}
