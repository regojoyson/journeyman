import type { CustomAiStep, CustomAiStepUpdateInput } from "@journeyman/core";

export interface SectionProps {
  step: CustomAiStep;
  patch: (p: CustomAiStepUpdateInput) => void;
  locked: boolean;
}
