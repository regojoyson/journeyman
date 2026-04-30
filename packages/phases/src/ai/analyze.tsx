// packages/phases/src/ai/analyze.tsx
import { z } from "zod";
import type { PhaseDefinition } from "@journeyman/flow-editor";
import { summaryValue } from "@journeyman/flow-editor";
import { ANALYZE_PHASE_TYPE, ANALYZE_LABEL, ANALYZE_CATEGORY, analyzeOutputSchema } from "./analyze.meta.ts";

interface AnalyzeConfig {
  dirPath: string;
  ticketContent: string;
}

export const analyzePhase: PhaseDefinition<AnalyzeConfig> = {
  phaseType: ANALYZE_PHASE_TYPE,
  label: ANALYZE_LABEL,
  category: ANALYZE_CATEGORY,
  description: "Analyze a repo against a ticket using a coding-cli provider.",
  color: "#00b894",
  icon: "🤖",
  defaultConfig: { dirPath: "", ticketContent: "" },
  configSchema: z.object({
    dirPath: z.string().min(1, "dirPath is required"),
    ticketContent: z.string().min(1, "ticketContent is required"),
  }),
  configFields: {
    dirPath:       { label: "Repo path",       widget: "text",     help: "Local path or workspace ref" },
    ticketContent: { label: "Ticket content",  widget: "textarea", help: "Markdown body of the ticket" },
  },
  tabs: { io: "shown", credentials: "required", mcp: "shown", retry: "shown" },
  summary: (c, ctx) => summaryValue(c, ctx, "dirPath") || "(no repo)",
  executor: { kind: "coding-cli", method: "analyze" },
  outputSchema: analyzeOutputSchema,
};
