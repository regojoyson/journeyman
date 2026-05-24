import type { StepDefinition } from "@journeyman/flow-editor";
import type { CanonicalTool } from "@journeyman/core";
import { CustomAiConfigForm } from "./CustomAiConfigForm.tsx";
import { CUSTOM_AI_STEP_TYPE, customAiConfigSchema } from "./custom-ai.meta.ts";

interface CustomAiConfig {
  customStepId: string;
  mcpInstanceIds?: string[];
  skillIds?: string[];
  tools?: CanonicalTool[];
}

export const customAiStep: StepDefinition<CustomAiConfig> = {
  stepType: CUSTOM_AI_STEP_TYPE,
  label: "Custom AI Step",
  category: "Custom",
  description: "User-defined AI step. Inputs/outputs and prompt are configured per definition.",
  color: "#a29bfe",
  icon: "🧩",
  defaultConfig: { customStepId: "" },
  configSchema: customAiConfigSchema,
  configFields: {},
  ConfigForm: CustomAiConfigForm,
  hiddenFromPalette: true,
  tabs: { io: "hidden", mcp: "shown", skills: "shown", retry: "shown" },
  supportsSkills: true,
  supportsModelSelection: true,
  slots: [],
  summary: (c) => c.customStepId ? `custom:${c.customStepId.slice(0, 8)}` : "(no step)",
  executor: { kind: "coding-cli", method: "runCustomPrompt" },
  outputSchema: {},
};
