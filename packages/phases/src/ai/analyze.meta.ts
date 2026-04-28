import type { OutputSchema } from "@journeyman/core";
import type { InputFields } from "../shared-meta.ts";

export const ANALYZE_PHASE_TYPE = "analyze";
export const ANALYZE_LABEL = "Analyze";
export const ANALYZE_CATEGORY = "AI";

export const analyzeOutputSchema: OutputSchema = {
  summary:       { type: "string", description: "Plain-language change summary" },
  complexity:    { type: "enum", values: ["low", "medium", "high"] },
  affectedFiles: { type: "string[]", description: "Files likely to change" },
};

export const analyzeInputFields: InputFields = {
  ticketKey:    { type: "string", label: "Ticket key", required: true },
  repoPath:     { type: "string", label: "Repo path", required: true },
  instructions: { type: "string", label: "Extra instructions" },
};
