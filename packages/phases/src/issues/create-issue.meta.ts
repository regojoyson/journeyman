import { z } from "zod";
import type { OutputSchema, InputFields } from "@journeyman/core";

export const createIssueConfigSchema = z.object({
  project: z.string().min(1),
  title: z.string().min(1),
  description: z.string(),
  labels: z.array(z.string()),
});

export const CREATE_ISSUE_PHASE_TYPE = "create-issue";
export const CREATE_ISSUE_LABEL = "Create Issue";
export const CREATE_ISSUE_CATEGORY = "Issue Tracker";
export const CREATE_ISSUE_DESCRIPTION =
  "Create an issue on the configured tracker.";

export const createIssueOutputSchema: OutputSchema = {
  id:  { type: "string" },
  url: { type: "string" },
};

export const createIssueInputFields: InputFields = {
  project:     { shape: { type: "string" }, label: "Project", required: true },
  title:       { shape: { type: "string" }, label: "Title", required: true },
  description: { shape: { type: "string" }, label: "Description" },
};
