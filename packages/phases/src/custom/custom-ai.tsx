import { z } from "zod";
import type { PhaseDefinition } from "@journeyman/flow-editor";

interface CustomAiConfig {
  customPhaseId: string;
  provider?: "claude" | "gemini" | "codex";
  mcpInstanceIds?: string[];
  skillIds?: string[];
}

export const customAiPhase: PhaseDefinition<CustomAiConfig> = {
  phaseType: "custom-ai",
  label: "Custom AI Phase",
  category: "Custom",
  description: "User-defined AI phase. Inputs/outputs and prompt are configured per definition.",
  color: "#a29bfe",
  icon: "🧩",
  defaultConfig: { customPhaseId: "" },
  configSchema: z.object({
    customPhaseId: z.string().min(1),
    provider: z.enum(["claude", "gemini", "codex"]).optional(),
    mcpInstanceIds: z.array(z.string()).optional(),
    skillIds: z.array(z.string()).optional(),
  }),
  configFields: {},
  tabs: { io: "shown", mcp: "shown", skills: "shown", retry: "shown" },
  supportsSkills: true,
  supportsModelSelection: true,
  slots: [
    { name: "ANTHROPIC_API_KEY", description: "Anthropic API key. Optional.", optional: true },
  ],
  summary: (c) => c.customPhaseId ? `custom:${c.customPhaseId.slice(0, 8)}` : "(no phase)",
  executor: { kind: "coding-cli", method: "runCustomPrompt" },
  outputSchema: {},
};
