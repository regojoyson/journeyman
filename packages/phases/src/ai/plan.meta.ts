import type { OutputSchema } from "@journeyman/core";
import type { InputFields } from "../shared-meta.ts";

export const PLAN_PHASE_TYPE = "plan";
export const PLAN_LABEL = "Plan";
export const PLAN_CATEGORY = "AI";

export const planOutputSchema: OutputSchema = {
  steps:            { type: "json", description: "Ordered list of implementation steps" },
  estimatedMinutes: { type: "number" },
};

export const planInputFields: InputFields = {
  dirPath:            { type: "string", label: "Repo path", required: true },
  ticketContent:      { type: "string", label: "Ticket content" },
  analyzeReportPath:  { type: "string", label: "Analyze report path" },
  focus:              { type: "string", label: "Focus / scope narrowing" },
  reviewComments:     { type: "string", label: "Reviewer comments" },
};
