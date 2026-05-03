import type { OutputSchema, InputFields } from "@journeyman/core";

export const COMMENT_ON_PULL_REQUEST_PHASE_TYPE = "comment-on-pull-request";
export const COMMENT_ON_PULL_REQUEST_LABEL = "Comment on Pull Request";
export const COMMENT_ON_PULL_REQUEST_CATEGORY = "Code Host";
export const COMMENT_ON_PULL_REQUEST_DESCRIPTION =
  "Post a comment on a pull/merge request, optionally rendered from a template.";

export const commentOnPullRequestOutputSchema: OutputSchema = {
  commentId: { type: "string" },
};

export const commentOnPullRequestInputFields: InputFields = {
  owner:    { shape: { type: "string" }, label: "Owner / org", required: true },
  repo:     { shape: { type: "string" }, label: "Repository", required: true },
  prNumber: { shape: { type: "number" }, label: "PR number" },
  template: { shape: { type: "string" }, label: "Template id" },
  body:     { shape: { type: "string" }, label: "Inline body (optional)" },
};
