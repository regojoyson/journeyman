// packages/phases/src/ai/plan.tsx
import { z } from "zod";
import type { PhaseDefinition } from "@journeyman/flow-editor";
import { summaryValue } from "@journeyman/flow-editor";
import { PLAN_PHASE_TYPE, PLAN_LABEL, PLAN_CATEGORY, planOutputSchema } from "./plan.meta.ts";

interface PlanConfig {
  dirPath: string;
  ticketContent?: string;
  analyzeReportPath?: string;
}

export const planPhase: PhaseDefinition<PlanConfig> = {
  phaseType: PLAN_PHASE_TYPE,
  label: PLAN_LABEL,
  category: PLAN_CATEGORY,
  description: "Produce an implementation plan from a ticket and (optionally) a prior analysis.",
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
  summary: (c, ctx) => summaryValue(c, ctx, "dirPath") || "(no repo)",
  executor: { kind: "coding-cli", method: "plan" },
  outputSchema: planOutputSchema,
};
