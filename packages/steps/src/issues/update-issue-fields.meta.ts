import { z } from "zod";
import type { OutputSchema, InputFields } from "@journeyman/core";

export const updateIssueFieldsConfigSchema = z.object({
  ref: z.string().min(1),
  fields: z.record(z.string(), z.string()),
});

export const UPDATE_ISSUE_FIELDS_STEP_TYPE = "update-issue-fields";
export const UPDATE_ISSUE_FIELDS_LABEL = "Update Issue Fields";
export const UPDATE_ISSUE_FIELDS_CATEGORY = "Issue Tracker";
export const UPDATE_ISSUE_FIELDS_DESCRIPTION =
  "Update arbitrary fields on an existing issue.";

export const updateIssueFieldsOutputSchema: OutputSchema = {
  updated: { type: "boolean" },
};

export const updateIssueFieldsInputFields: InputFields = {
  ref: { shape: { type: "string" }, label: "Ref", required: true },
  fields:   { shape: { type: "object", fields: {} }, label: "Fields" },
};
