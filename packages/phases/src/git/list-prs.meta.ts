import type { InputFields } from "../shared-meta.ts";

export const LIST_PRS_PHASE_TYPE = "list-prs";
export const LIST_PRS_LABEL = "List PRs";
export const LIST_PRS_CATEGORY = "Git";

export const listPrsInputFields: InputFields = {
  owner: { type: "string", label: "Owner / org", required: true },
  repo:  { type: "string", label: "Repository", required: true },
  state: { type: "string", label: "State" },
};
