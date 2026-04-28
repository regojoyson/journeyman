import type { InputFields } from "../shared-meta.ts";

export const FETCH_PR_COMMENTS_PHASE_TYPE = "fetch-pr-comments";
export const FETCH_PR_COMMENTS_LABEL = "Fetch PR Comments";
export const FETCH_PR_COMMENTS_CATEGORY = "Git";

export const fetchPrCommentsInputFields: InputFields = {
  owner:    { type: "string", label: "Owner / org", required: true },
  repo:     { type: "string", label: "Repository", required: true },
  prNumber: { type: "number", label: "PR number" },
};
