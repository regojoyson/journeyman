import type { PhaseDefinition } from "@journeyman/flow-editor";
import type { CanonicalTool } from "@journeyman/core";
import { CustomAiConfigForm } from "./CustomAiConfigForm.tsx";
import { CUSTOM_AI_PHASE_TYPE, customAiConfigSchema } from "./custom-ai.meta.ts";

interface CustomAiConfig {
  customPhaseId: string;
  mcpInstanceIds?: string[];
  skillIds?: string[];
  tools?: CanonicalTool[];
}

export const customAiPhase: PhaseDefinition<CustomAiConfig> = {
  phaseType: CUSTOM_AI_PHASE_TYPE,
  label: "Custom AI Phase",
  category: "Custom",
  description: "User-defined AI phase. Inputs/outputs and prompt are configured per definition.",
  color: "#a29bfe",
  icon: "🧩",
  defaultConfig: { customPhaseId: "" },
  configSchema: customAiConfigSchema,
  configFields: {},
  ConfigForm: CustomAiConfigForm,
  hiddenFromPalette: true,
  tabs: { io: "hidden", mcp: "shown", skills: "shown", retry: "shown" },
  supportsSkills: true,
  supportsModelSelection: true,
  slots: [
    { name: "ANTHROPIC_API_KEY", description: "Anthropic API key. Optional.", optional: true },
  ],
  summary: (c) => c.customPhaseId ? `custom:${c.customPhaseId.slice(0, 8)}` : "(no phase)",
  executor: { kind: "coding-cli", method: "runCustomPrompt" },
  outputSchema: {},
};
