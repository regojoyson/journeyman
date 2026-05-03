import type { OutputSchema, InputFields } from "@journeyman/core";

export const UPDATE_ISSUE_FIELDS_PHASE_TYPE = "update-issue-fields";
export const UPDATE_ISSUE_FIELDS_LABEL = "Update Issue Fields";
export const UPDATE_ISSUE_FIELDS_CATEGORY = "Issue Tracker";
export const UPDATE_ISSUE_FIELDS_DESCRIPTION =
  "Update arbitrary fields on an existing issue.";

export const updateIssueFieldsOutputSchema: OutputSchema = {
  updated: { type: "boolean" },
};

export const updateIssueFieldsInputFields: InputFields = {
  issueRef: { shape: { type: "string" }, label: "Issue ref", required: true },
  fields:   { shape: { type: "object", fields: {} }, label: "Fields" },
};
