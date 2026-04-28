// packages/phases/src/ai/analyze.tsx
import { z } from "zod";
import type { PhaseDefinition } from "@journeyman/flow-editor";
import { ANALYZE_PHASE_TYPE, ANALYZE_LABEL, ANALYZE_CATEGORY, analyzeOutputSchema } from "./analyze.meta.ts";

interface AnalyzeConfig {
  ticketKey: string;
  repoPath: string;
  instructions?: string;
}

export const analyzePhase: PhaseDefinition<AnalyzeConfig> = {
  phaseType: ANALYZE_PHASE_TYPE,
  label: ANALYZE_LABEL,
  category: ANALYZE_CATEGORY,
  description: "Analyze a repo against a ticket using a coding-cli provider.",
  color: "#00b894",
  icon: "🤖",
  defaultConfig: { ticketKey: "", repoPath: "", instructions: "" },
  configSchema: z.object({
    ticketKey: z.string().min(1, "ticketKey is required"),
    repoPath: z.string().min(1, "repoPath is required"),
    instructions: z.string().optional(),
  }),
  configFields: {
    ticketKey:    { label: "Ticket key",    widget: "text",     help: "e.g. PROJ-123" },
    repoPath:     { label: "Repo path",     widget: "text",     help: "Local path or workspace ref" },
    instructions: { label: "Extra instructions", widget: "textarea", help: "Optional additional analysis instructions" },
  },
  tabs: { io: "shown", credentials: "required", mcp: "shown", retry: "shown" },
  summary: c => c.ticketKey || "(no ticket)",
  executor: { kind: "coding-cli", method: "analyze" },
  outputSchema: analyzeOutputSchema,
};
