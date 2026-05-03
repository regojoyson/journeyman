import type { OutputSchema, InputFields } from "@journeyman/core";

export const LIST_PULL_REQUEST_COMMENTS_PHASE_TYPE = "list-pull-request-comments";
export const LIST_PULL_REQUEST_COMMENTS_LABEL = "List Pull Request Comments";
export const LIST_PULL_REQUEST_COMMENTS_CATEGORY = "Code Host";
export const LIST_PULL_REQUEST_COMMENTS_DESCRIPTION =
  "Read all comments from a pull/merge request.";

export const listPullRequestCommentsOutputSchema: OutputSchema = {
  comments: {
    type: "array",
    items: {
      type: "object",
      fields: {
        id:     { type: "string" },
        body:   { type: "string" },
        author: { type: "string" },
      },
    },
  },
};

export const listPullRequestCommentsInputFields: InputFields = {
  owner:    { shape: { type: "string" }, label: "Owner / org", required: true },
  repo:     { shape: { type: "string" }, label: "Repository", required: true },
  prNumber: { shape: { type: "number" }, label: "PR number" },
};
