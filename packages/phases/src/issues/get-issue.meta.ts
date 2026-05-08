import { z } from "zod";
import type { OutputSchema, InputFields } from "@journeyman/core";

export const getIssueConfigSchema = z.object({
  issueRef: z.string().min(1),
});

export const GET_ISSUE_PHASE_TYPE = "get-issue";
export const GET_ISSUE_LABEL = "Get Issue";
export const GET_ISSUE_CATEGORY = "Issue Tracker";
export const GET_ISSUE_DESCRIPTION =
  "Fetch an issue from the configured tracker.";

export const getIssueOutputSchema: OutputSchema = {
  issue: { type: "ref", name: "Issue", description: "The fetched Issue object" },
};

export const getIssueInputFields: InputFields = {
  issueRef: { shape: { type: "string" }, label: "Issue ref", required: true },
};
