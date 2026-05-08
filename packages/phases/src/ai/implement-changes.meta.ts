import { z } from "zod";
import type { OutputSchema, InputFields } from "@journeyman/core";

export const implementChangesConfigSchema = z.object({
  planReportPath: z.string().min(1),
  analyzeReportPath: z.string().optional(),
});

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
  workspaceDir:      { shape: { type: "string" }, label: "Workspace dir", required: true, bindOnly: true },
  planReportPath:    { shape: { type: "string" }, label: "Plan report path", required: true },
  issue:             { shape: { type: "ref", name: "Issue" }, label: "Issue", bindOnly: true },
  analyzeReportPath: { shape: { type: "string" }, label: "Analyze report path" },
  focus:             { shape: { type: "string" }, label: "Focus / scope narrowing" },
  reviewComments:    { shape: { type: "string" }, label: "Reviewer comments" },
};
