import type { OutputSchema, InputFields } from "@journeyman/core";

export const OPEN_PULL_REQUEST_PHASE_TYPE = "open-pull-request";
export const OPEN_PULL_REQUEST_LABEL = "Open Pull Request";
export const OPEN_PULL_REQUEST_CATEGORY = "Code Host";
export const OPEN_PULL_REQUEST_DESCRIPTION =
  "Open a pull/merge request on the remote.";

export const openPullRequestOutputSchema: OutputSchema = {
  pullRequests: { type: "array", items: { type: "ref", name: "PullRequest" }, description: "All PRs opened (one per repo when `repos` input is wired)" },
  pullRequest:  { type: "ref", name: "PullRequest", description: "Convenience: the first PR (matches single-repo flows)" },
};

export const openPullRequestInputFields: InputFields = {
  repos:        { shape: { type: "array", items: { type: "ref", name: "Repo" } }, label: "Repos", required: true, bindOnly: true },
  title:        { shape: { type: "string" }, label: "Title", required: true },
  body:         { shape: { type: "string" }, label: "Body" },
  sourceBranch: { shape: { type: "string" }, label: "Source branch", required: true },
};
