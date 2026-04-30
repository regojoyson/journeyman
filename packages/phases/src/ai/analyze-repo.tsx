import { z } from "zod";
import type { PhaseDefinition } from "@journeyman/flow-editor";
import { summaryValue } from "@journeyman/flow-editor";
import {
  ANALYZE_REPO_PHASE_TYPE,
  ANALYZE_REPO_LABEL,
  ANALYZE_REPO_CATEGORY,
  ANALYZE_REPO_DESCRIPTION,
  analyzeRepoOutputSchema,
} from "./analyze-repo.meta.ts";

interface AnalyzeRepoConfig {
  dirPath: string;
  ticketContent: string;
}

export const analyzeRepoPhase: PhaseDefinition<AnalyzeRepoConfig> = {
  phaseType: ANALYZE_REPO_PHASE_TYPE,
  label: ANALYZE_REPO_LABEL,
  category: ANALYZE_REPO_CATEGORY,
  description: ANALYZE_REPO_DESCRIPTION,
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
  optionalSecrets: ["ANTHROPIC_API_KEY"],
  summary: (c, ctx) => summaryValue(c, ctx, "dirPath") || "(no repo)",
  executor: { kind: "coding-cli", method: "analyze" },
  outputSchema: analyzeRepoOutputSchema,
};
