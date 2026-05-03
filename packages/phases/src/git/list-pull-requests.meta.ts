import type { OutputSchema, InputFields } from "@journeyman/core";

export const LIST_PULL_REQUESTS_PHASE_TYPE = "list-pull-requests";
export const LIST_PULL_REQUESTS_LABEL = "List Pull Requests";
export const LIST_PULL_REQUESTS_CATEGORY = "Code Host";
export const LIST_PULL_REQUESTS_DESCRIPTION =
  "List pull/merge requests on a repository, filtered by state.";

export const listPullRequestsOutputSchema: OutputSchema = {
  pullRequests: { type: "array", items: { type: "ref", name: "PullRequest" } },
};

export const listPullRequestsInputFields: InputFields = {
  owner: { shape: { type: "string" }, label: "Owner / org", required: true },
  repo:  { shape: { type: "string" }, label: "Repository", required: true },
  state: { shape: { type: "string" }, label: "State" },
};
