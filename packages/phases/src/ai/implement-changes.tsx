import type { PhaseDefinition } from "@journeyman/flow-editor";
import {
  IMPLEMENT_CHANGES_PHASE_TYPE,
  IMPLEMENT_CHANGES_LABEL,
  IMPLEMENT_CHANGES_CATEGORY,
  IMPLEMENT_CHANGES_DESCRIPTION,
  implementChangesOutputSchema,
  implementChangesConfigSchema,
} from "./implement-changes.meta.ts";

interface ImplementChangesConfig {
  planReportPath: string;
  analyzeReportPath?: string;
}

export const implementChangesPhase: PhaseDefinition<ImplementChangesConfig> = {
  phaseType: IMPLEMENT_CHANGES_PHASE_TYPE,
  label: IMPLEMENT_CHANGES_LABEL,
  category: IMPLEMENT_CHANGES_CATEGORY,
  description: IMPLEMENT_CHANGES_DESCRIPTION,
  color: "#6c5ce7",
  icon: "🛠",
  defaultConfig: { planReportPath: "", analyzeReportPath: "" },
  configSchema: implementChangesConfigSchema,
  configFields: {
    planReportPath:    { label: "Plan report path",     widget: "text", help: "Path to a prior plan output" },
    analyzeReportPath: { label: "Analyze report path",  widget: "text", help: "Optional path to a prior analyze output" },
  },
  tabs: { io: "shown", mcp: "shown", skills: "shown", retry: "shown" },
  supportsSkills: true,
  supportsModelSelection: true,
  slots: [
    {
      name: "ANTHROPIC_API_KEY",
      description: "Anthropic API key. Optional — falls back to the SDK's ambient credentials when unset.",
      optional: true,
    },
  ],
  summary: c => c.planReportPath || "(no plan)",
  executor: { kind: "coding-cli", method: "implement" },
  outputSchema: implementChangesOutputSchema,
};
