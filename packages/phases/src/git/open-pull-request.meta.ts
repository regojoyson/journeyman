import type { OutputSchema, InputFields } from "@journeyman/core";

export const OPEN_PULL_REQUEST_PHASE_TYPE = "open-pull-request";
export const OPEN_PULL_REQUEST_LABEL = "Open Pull Request";
export const OPEN_PULL_REQUEST_CATEGORY = "Code Host";
export const OPEN_PULL_REQUEST_DESCRIPTION =
  "Open a pull/merge request on the remote.";

export const openPullRequestOutputSchema: OutputSchema = {
  pullRequest: { type: "ref", name: "PullRequest" },
};

export const openPullRequestInputFields: InputFields = {
  owner: { shape: { type: "string" }, label: "Owner / org", required: true },
  repo:  { shape: { type: "string" }, label: "Repository", required: true },
  title: { shape: { type: "string" }, label: "Title", required: true },
  body:  { shape: { type: "string" }, label: "Body" },
  head:  { shape: { type: "string" }, label: "Head branch", required: true },
  base:  { shape: { type: "string" }, label: "Base branch", required: true },
};
