// packages/phases/src/ai/implement.tsx
import { z } from "zod";
import type { PhaseDefinition } from "@journeyman/flow-editor";
import { IMPLEMENT_PHASE_TYPE, IMPLEMENT_LABEL, IMPLEMENT_CATEGORY, implementOutputSchema } from "./implement.meta.ts";

interface ImplementConfig {
  dirPath: string;
  planReportPath: string;
  ticketContent?: string;
  analyzeReportPath?: string;
}

export const implementPhase: PhaseDefinition<ImplementConfig> = {
  phaseType: IMPLEMENT_PHASE_TYPE,
  label: IMPLEMENT_LABEL,
  category: IMPLEMENT_CATEGORY,
  description: "Execute a plan against a repo using a coding-cli provider.",
  color: "#6c5ce7",
  icon: "🛠",
  defaultConfig: { dirPath: "", planReportPath: "", ticketContent: "", analyzeReportPath: "" },
  configSchema: z.object({
    dirPath: z.string().min(1),
    planReportPath: z.string().min(1),
    ticketContent: z.string().optional(),
    analyzeReportPath: z.string().optional(),
  }),
  configFields: {
    dirPath:           { label: "Repo path",            widget: "text" },
    planReportPath:    { label: "Plan report path",     widget: "text", help: "Path to a prior plan output" },
    ticketContent:     { label: "Ticket content",       widget: "textarea", help: "Markdown body of the ticket" },
    analyzeReportPath: { label: "Analyze report path",  widget: "text", help: "Optional path to a prior analyze output" },
  },
  tabs: { io: "shown", credentials: "required", mcp: "shown", retry: "shown" },
  summary: c => c.planReportPath || "(no plan)",
  executor: { kind: "coding-cli", method: "implement" },
  outputSchema: implementOutputSchema,
};
