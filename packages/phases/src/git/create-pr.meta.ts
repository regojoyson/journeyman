import type { InputFields } from "../shared-meta.ts";

export const CREATE_PR_PHASE_TYPE = "create-pr";
export const CREATE_PR_LABEL = "Create PR";
export const CREATE_PR_CATEGORY = "Git";

export const createPrInputFields: InputFields = {
  owner: { type: "string", label: "Owner / org", required: true },
  repo:  { type: "string", label: "Repository", required: true },
  title: { type: "string", label: "Title", required: true },
  body:  { type: "string", label: "Body" },
  head:  { type: "string", label: "Head branch", required: true },
  base:  { type: "string", label: "Base branch", required: true },
};
