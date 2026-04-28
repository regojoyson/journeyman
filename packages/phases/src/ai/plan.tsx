// packages/phases/src/ai/plan.tsx
import { z } from "zod";
import type { PhaseDefinition } from "@journeyman/flow-editor";
import { PLAN_PHASE_TYPE, PLAN_LABEL, PLAN_CATEGORY, planOutputSchema } from "./plan.meta.ts";

interface PlanConfig {
  ticketKey: string;
  repoPath: string;
  analysisRef?: string;
}

export const planPhase: PhaseDefinition<PlanConfig> = {
  phaseType: PLAN_PHASE_TYPE,
  label: PLAN_LABEL,
  category: PLAN_CATEGORY,
  description: "Produce an implementation plan from a ticket and (optionally) a prior analysis.",
  color: "#0984e3",
  icon: "📝",
  defaultConfig: { ticketKey: "", repoPath: "", analysisRef: "" },
  configSchema: z.object({
    ticketKey: z.string().min(1),
    repoPath: z.string().min(1),
    analysisRef: z.string().optional(),
  }),
  configFields: {
    ticketKey:   { label: "Ticket key", widget: "text" },
    repoPath:    { label: "Repo path",  widget: "text" },
    analysisRef: { label: "Analysis ref", widget: "text", help: "Optional reference to a prior analyze output" },
  },
  tabs: { io: "shown", credentials: "required", mcp: "shown", retry: "shown" },
  summary: c => c.ticketKey || "(no ticket)",
  executor: { kind: "coding-cli", method: "plan" },
  outputSchema: planOutputSchema,
};
