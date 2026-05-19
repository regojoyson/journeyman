import { z } from "zod";
import type { OutputSchema, InputFields } from "@journeyman/core";

export const commentOnIssueConfigSchema = z.object({
  issueRef: z.string().min(1),
  template: z.string(),
  body: z.string().optional(),
});

export const COMMENT_ON_ISSUE_PHASE_TYPE = "comment-on-issue";
export const COMMENT_ON_ISSUE_LABEL = "Comment on Issue";
export const COMMENT_ON_ISSUE_CATEGORY = "Issue Tracker";
export const COMMENT_ON_ISSUE_DESCRIPTION =
  "Post a comment on an issue, optionally rendered from a template.";

export const commentOnIssueOutputSchema: OutputSchema = {
  commentId: { type: "string" },
};

export const commentOnIssueInputFields: InputFields = {
  issueRef: { shape: { type: "string" }, label: "Issue ref", required: true },
  template: { shape: { type: "string" }, label: "Template" },
  body:     { shape: { type: "string" }, label: "Body" },
};
