import type { OutputSchema } from "@journeyman/core";
import type { InputFields } from "../shared-meta.ts";

export const PLAN_IMPLEMENTATION_PHASE_TYPE = "plan-implementation";
export const PLAN_IMPLEMENTATION_LABEL = "Plan Implementation";
export const PLAN_IMPLEMENTATION_CATEGORY = "Coding Agent";
export const PLAN_IMPLEMENTATION_DESCRIPTION =
  "Produce an ordered implementation plan from a ticket and (optionally) a prior analysis.";

export const planImplementationOutputSchema: OutputSchema = {
  steps:            { type: "json", description: "Ordered list of implementation steps" },
  estimatedMinutes: { type: "number" },
};

export const planImplementationInputFields: InputFields = {
  repoDir:            { type: "string", label: "Repo directory", required: true },
  ticketContent:      { type: "string", label: "Ticket content" },
  analyzeReportPath:  { type: "string", label: "Analyze report path" },
  focus:              { type: "string", label: "Focus / scope narrowing" },
  reviewComments:     { type: "string", label: "Reviewer comments" },
};
