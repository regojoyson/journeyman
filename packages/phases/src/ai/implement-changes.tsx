import { z } from "zod";
import type { PhaseDefinition } from "@journeyman/flow-editor";
import {
  IMPLEMENT_CHANGES_PHASE_TYPE,
  IMPLEMENT_CHANGES_LABEL,
  IMPLEMENT_CHANGES_CATEGORY,
  IMPLEMENT_CHANGES_DESCRIPTION,
  implementChangesOutputSchema,
} from "./implement-changes.meta.ts";

interface ImplementChangesConfig {
  dirPath: string;
  planReportPath: string;
  ticketContent?: string;
  analyzeReportPath?: string;
}

export const implementChangesPhase: PhaseDefinition<ImplementChangesConfig> = {
  phaseType: IMPLEMENT_CHANGES_PHASE_TYPE,
  label: IMPLEMENT_CHANGES_LABEL,
  category: IMPLEMENT_CHANGES_CATEGORY,
  description: IMPLEMENT_CHANGES_DESCRIPTION,
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
  optionalSecrets: ["ANTHROPIC_API_KEY"],
  summary: c => c.planReportPath || "(no plan)",
  executor: { kind: "coding-cli", method: "implement" },
  outputSchema: implementChangesOutputSchema,
};
