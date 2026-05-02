import type { OutputSchema } from "@journeyman/core";
import type { InputFields } from "../shared-meta.ts";

export const IMPLEMENT_CHANGES_PHASE_TYPE = "implement-changes";
export const IMPLEMENT_CHANGES_LABEL = "Implement Changes";
export const IMPLEMENT_CHANGES_CATEGORY = "Coding Agent";
export const IMPLEMENT_CHANGES_DESCRIPTION =
  "Execute an implementation plan against a repo using a coding agent; emits a diff summary and the list of changed files.";

export const implementChangesOutputSchema: OutputSchema = {
  filesChanged: { type: "string[]" },
  diffSummary:  { type: "string" },
};

export const implementChangesInputFields: InputFields = {
  repoDir:            { type: "string", label: "Repo directory", required: true },
  planReportPath:     { type: "string", label: "Plan report path", required: true },
  ticketContent:      { type: "string", label: "Ticket content" },
  analyzeReportPath:  { type: "string", label: "Analyze report path" },
  focus:              { type: "string", label: "Focus / scope narrowing" },
  reviewComments:     { type: "string", label: "Reviewer comments" },
};
