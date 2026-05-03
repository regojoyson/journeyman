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
  repoDir: string;
  issueContent?: string;
  analyzeReportPath?: string;
}

export const planImplementationPhase: PhaseDefinition<PlanImplementationConfig> = {
  phaseType: PLAN_IMPLEMENTATION_PHASE_TYPE,
  label: PLAN_IMPLEMENTATION_LABEL,
  category: PLAN_IMPLEMENTATION_CATEGORY,
  description: PLAN_IMPLEMENTATION_DESCRIPTION,
  color: "#0984e3",
  icon: "📝",
  defaultConfig: { repoDir: "", issueContent: "", analyzeReportPath: "" },
  configSchema: z.object({
    repoDir: z.string().min(1),
    issueContent: z.string().optional(),
    analyzeReportPath: z.string().optional(),
  }),
  configFields: {
    repoDir:           { label: "Repo directory",      widget: "text" },
    issueContent:     { label: "Issue content",     widget: "textarea", help: "Markdown body of the issue" },
    analyzeReportPath: { label: "Analyze report path", widget: "text", help: "Optional path to a prior analyze output" },
  },
  tabs: { io: "shown", mcp: "shown", retry: "shown" },
  slots: [
    {
      name: "ANTHROPIC_API_KEY",
      description: "Anthropic API key. Optional — falls back to the SDK's ambient credentials when unset.",
      optional: true,
    },
  ],
  summary: (c, ctx) => summaryValue(c, ctx, "repoDir") || "(no repo)",
  executor: { kind: "coding-cli", method: "plan" },
  outputSchema: planImplementationOutputSchema,
};
