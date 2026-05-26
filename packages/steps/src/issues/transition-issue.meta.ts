import { z } from "zod";
import type { OutputSchema, InputFields } from "@journeyman/core";

export const transitionIssueConfigSchema = z.object({
  ref: z.string().min(1),
  status: z.string().min(1),
});

export const TRANSITION_ISSUE_STEP_TYPE = "transition-issue";
export const TRANSITION_ISSUE_LABEL = "Transition Issue";
export const TRANSITION_ISSUE_CATEGORY = "Issue Tracker";
export const TRANSITION_ISSUE_DESCRIPTION =
  "Move an issue to a new workflow status.";

export const transitionIssueOutputSchema: OutputSchema = {
  status: { type: "string" },
};

export const transitionIssueInputFields: InputFields = {
  ref: { shape: { type: "string" }, label: "Ref", required: true },
  status:   { shape: { type: "string" }, label: "Status", required: true },
};
