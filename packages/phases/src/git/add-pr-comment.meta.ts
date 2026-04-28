import type { InputFields } from "../shared-meta.ts";

export const ADD_PR_COMMENT_PHASE_TYPE = "add-pr-comment";
export const ADD_PR_COMMENT_LABEL = "Add PR Comment";
export const ADD_PR_COMMENT_CATEGORY = "Git";

export const addPrCommentInputFields: InputFields = {
  owner:    { type: "string", label: "Owner / org", required: true },
  repo:     { type: "string", label: "Repository", required: true },
  prNumber: { type: "number", label: "PR number" },
  template: { type: "string", label: "Template id" },
  body:     { type: "string", label: "Inline body (optional)" },
};
