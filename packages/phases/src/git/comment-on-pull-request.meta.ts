import type { InputFields } from "../shared-meta.ts";

export const COMMENT_ON_PULL_REQUEST_PHASE_TYPE = "comment-on-pull-request";
export const COMMENT_ON_PULL_REQUEST_LABEL = "Comment on Pull Request";
export const COMMENT_ON_PULL_REQUEST_CATEGORY = "Code Host";
export const COMMENT_ON_PULL_REQUEST_DESCRIPTION =
  "Post a comment on a pull/merge request, optionally rendered from a template.";

export const commentOnPullRequestInputFields: InputFields = {
  owner:    { type: "string", label: "Owner / org", required: true },
  repo:     { type: "string", label: "Repository", required: true },
  prNumber: { type: "number", label: "PR number" },
  template: { type: "string", label: "Template id" },
  body:     { type: "string", label: "Inline body (optional)" },
};
