import type { InputFields } from "../shared-meta.ts";

export const OPEN_PULL_REQUEST_PHASE_TYPE = "open-pull-request";
export const OPEN_PULL_REQUEST_LABEL = "Open Pull Request";
export const OPEN_PULL_REQUEST_CATEGORY = "Code Host";
export const OPEN_PULL_REQUEST_DESCRIPTION =
  "Open a pull/merge request on the remote.";

export const openPullRequestInputFields: InputFields = {
  owner: { type: "string", label: "Owner / org", required: true },
  repo:  { type: "string", label: "Repository", required: true },
  title: { type: "string", label: "Title", required: true },
  body:  { type: "string", label: "Body" },
  head:  { type: "string", label: "Head branch", required: true },
  base:  { type: "string", label: "Base branch", required: true },
};
