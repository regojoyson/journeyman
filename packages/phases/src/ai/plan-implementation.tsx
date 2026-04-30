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
  dirPath: string;
  ticketContent?: string;
  analyzeReportPath?: string;
}

export const planImplementationPhase: PhaseDefinition<PlanImplementationConfig> = {
  phaseType: PLAN_IMPLEMENTATION_PHASE_TYPE,
  label: PLAN_IMPLEMENTATION_LABEL,
  category: PLAN_IMPLEMENTATION_CATEGORY,
  description: PLAN_IMPLEMENTATION_DESCRIPTION,
  color: "#0984e3",
  icon: "📝",
  defaultConfig: { dirPath: "", ticketContent: "", analyzeReportPath: "" },
  configSchema: z.object({
    dirPath: z.string().min(1),
    ticketContent: z.string().optional(),
    analyzeReportPath: z.string().optional(),
  }),
  configFields: {
    dirPath:           { label: "Repo path",           widget: "text" },
    ticketContent:     { label: "Ticket content",     widget: "textarea", help: "Markdown body of the ticket" },
    analyzeReportPath: { label: "Analyze report path", widget: "text", help: "Optional path to a prior analyze output" },
  },
  tabs: { io: "shown", credentials: "required", mcp: "shown", retry: "shown" },
  optionalSecrets: ["ANTHROPIC_API_KEY"],
  summary: (c, ctx) => summaryValue(c, ctx, "dirPath") || "(no repo)",
  executor: { kind: "coding-cli", method: "plan" },
  outputSchema: planImplementationOutputSchema,
};
