// packages/phases/src/ai/plan.tsx
import { z } from "zod";
import type { PhaseDefinition } from "@journeyman/flow-editor";

interface PlanConfig {
  ticketKey: string;
  repoPath: string;
  analysisRef?: string;
}

export const planPhase: PhaseDefinition<PlanConfig> = {
  phaseType: "plan",
  label: "Plan",
  category: "AI",
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
};
