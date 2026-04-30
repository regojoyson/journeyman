import type { InputFields } from "../shared-meta.ts";

export const LIST_PULL_REQUEST_COMMENTS_PHASE_TYPE = "list-pull-request-comments";
export const LIST_PULL_REQUEST_COMMENTS_LABEL = "List Pull Request Comments";
export const LIST_PULL_REQUEST_COMMENTS_CATEGORY = "Code Host";
export const LIST_PULL_REQUEST_COMMENTS_DESCRIPTION =
  "Read all comments from a pull/merge request.";

export const listPullRequestCommentsInputFields: InputFields = {
  owner:    { type: "string", label: "Owner / org", required: true },
  repo:     { type: "string", label: "Repository", required: true },
  prNumber: { type: "number", label: "PR number" },
};
