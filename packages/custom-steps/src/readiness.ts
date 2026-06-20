import type { CustomAiStep } from "@journeyman/core";

export interface ReadinessError {
  field: string;
  message: string;
}

/** Returns [] when the step may be enabled; otherwise a list of blocking errors. */
export function checkCustomStepReadiness(step: CustomAiStep): ReadinessError[] {
  const errs: ReadinessError[] = [];
  if (!step.name.trim())
    errs.push({ field: "name", message: "Name is required" });
  if (!step.promptTemplate.trim())
    errs.push({ field: "promptTemplate", message: "Prompt template is required" });
  return errs;
}
