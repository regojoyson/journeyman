import type { OutputSchema } from "@journeyman/core";
import type { InputFields } from "../shared-meta.ts";

export const IMPLEMENT_PHASE_TYPE = "implement";
export const IMPLEMENT_LABEL = "Implement";
export const IMPLEMENT_CATEGORY = "AI";

export const implementOutputSchema: OutputSchema = {
  filesChanged: { type: "string[]" },
  diffSummary:  { type: "string" },
};

export const implementInputFields: InputFields = {
  dirPath:            { type: "string", label: "Repo path", required: true },
  planReportPath:     { type: "string", label: "Plan report path", required: true },
  ticketContent:      { type: "string", label: "Ticket content" },
  analyzeReportPath:  { type: "string", label: "Analyze report path" },
  focus:              { type: "string", label: "Focus / scope narrowing" },
  reviewComments:     { type: "string", label: "Reviewer comments" },
};
