import type { InputFields } from "../shared-meta.ts";

export const GET_REPO_PHASE_TYPE = "get-repo";
export const GET_REPO_LABEL = "Get Repo";
export const GET_REPO_CATEGORY = "Git";

export const getRepoInputFields: InputFields = {
  owner: { type: "string", label: "Owner / org", required: true },
  repo:  { type: "string", label: "Repository", required: true },
};
