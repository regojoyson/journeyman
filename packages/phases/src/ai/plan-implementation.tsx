import { z } from "zod";
import type { PhaseDefinition } from "@journeyman/flow-editor";
import { summaryValue } from "@journeyman/flow-editor";
import {
  PLAN_IMPLEMENTATION_PHASE_TYPE,
  PLAN_IMPLEMENTATION_LABEL,
  PLAN_IMPLEMENTATION_CATEGORY,
  PLAN_IMPLEMENTATION_DESCRIPTION,
  planImplementationOutputSchema,
} from "./plan-implementation.meta.ts";

interface PlanImplementationConfig {
  analyzeReportPath?: string;
}

export const planImplementationPhase: PhaseDefinition<PlanImplementationConfig> = {
  phaseType: PLAN_IMPLEMENTATION_PHASE_TYPE,
  label: PLAN_IMPLEMENTATION_LABEL,
  category: PLAN_IMPLEMENTATION_CATEGORY,
  description: PLAN_IMPLEMENTATION_DESCRIPTION,
  color: "#0984e3",
  icon: "📝",
  defaultConfig: { analyzeReportPath: "" },
  configSchema: z.object({
    analyzeReportPath: z.string().optional(),
  }),
  configFields: {
    analyzeReportPath: { label: "Analyze report path", widget: "text", help: "Optional path to a prior analyze output" },
  },
  tabs: { io: "shown", mcp: "shown", skills: "shown", retry: "shown" },
  supportsSkills: true,
  slots: [
    {
      name: "ANTHROPIC_API_KEY",
      description: "Anthropic API key. Optional — falls back to the SDK's ambient credentials when unset.",
      optional: true,
    },
  ],
  summary: (c, ctx) => summaryValue(c, ctx, "workspaceDir") || "(no workspace)",
  executor: { kind: "coding-cli", method: "plan" },
  outputSchema: planImplementationOutputSchema,
};
