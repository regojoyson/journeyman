import type { InputFields } from "../shared-meta.ts";

export const LIST_PULL_REQUESTS_PHASE_TYPE = "list-pull-requests";
export const LIST_PULL_REQUESTS_LABEL = "List Pull Requests";
export const LIST_PULL_REQUESTS_CATEGORY = "Code Host";
export const LIST_PULL_REQUESTS_DESCRIPTION =
  "List pull/merge requests on a repository, filtered by state.";

export const listPullRequestsInputFields: InputFields = {
  owner: { type: "string", label: "Owner / org", required: true },
  repo:  { type: "string", label: "Repository", required: true },
  state: { type: "string", label: "State" },
};
