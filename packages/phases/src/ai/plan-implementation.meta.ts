import type { OutputSchema, InputFields } from "@journeyman/core";

export const PLAN_IMPLEMENTATION_PHASE_TYPE = "plan-implementation";
export const PLAN_IMPLEMENTATION_LABEL = "Plan Implementation";
export const PLAN_IMPLEMENTATION_CATEGORY = "Coding Agent";
export const PLAN_IMPLEMENTATION_DESCRIPTION =
  "Produce an ordered implementation plan from an issue and (optionally) a prior analysis.";

export const planImplementationOutputSchema: OutputSchema = {
  steps:                { type: "array", items: { type: "string" }, description: "Ordered list of step titles" },
  affectedFiles:        { type: "array", items: { type: "string" } },
  estimatedComplexity:  { type: "string", description: "One of: low|medium|high" },
  planReportPath:       { type: "string", description: "Path to the markdown plan report" },
};

export const planImplementationInputFields: InputFields = {
  repoDir:           { shape: { type: "string" }, label: "Repo directory", required: true },
  issueContent:      { shape: { type: "string" }, label: "Issue content" },
  analyzeReportPath: { shape: { type: "string" }, label: "Analyze report path" },
  focus:             { shape: { type: "string" }, label: "Focus / scope narrowing" },
  reviewComments:    { shape: { type: "string" }, label: "Reviewer comments" },
};
