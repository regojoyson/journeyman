import type { OutputSchema, InputFields } from "@journeyman/core";

export const IMPLEMENT_CHANGES_PHASE_TYPE = "implement-changes";
export const IMPLEMENT_CHANGES_LABEL = "Implement Changes";
export const IMPLEMENT_CHANGES_CATEGORY = "Coding Agent";
export const IMPLEMENT_CHANGES_DESCRIPTION =
  "Execute an implementation plan against a repo using a coding agent; emits a diff summary and the list of changed files.";

export const implementChangesOutputSchema: OutputSchema = {
  filesChanged: { type: "array", items: { type: "string" } },
  diffSummary:  { type: "string" },
};

export const implementChangesInputFields: InputFields = {
  repoDir:           { shape: { type: "string" }, label: "Repo directory", required: true },
  planReportPath:    { shape: { type: "string" }, label: "Plan report path", required: true },
  issueContent:      { shape: { type: "string" }, label: "Issue content" },
  analyzeReportPath: { shape: { type: "string" }, label: "Analyze report path" },
  focus:             { shape: { type: "string" }, label: "Focus / scope narrowing" },
  reviewComments:    { shape: { type: "string" }, label: "Reviewer comments" },
};
