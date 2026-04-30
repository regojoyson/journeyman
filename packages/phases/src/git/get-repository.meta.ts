import type { InputFields } from "../shared-meta.ts";

export const GET_REPOSITORY_PHASE_TYPE = "get-repository";
export const GET_REPOSITORY_LABEL = "Get Repository";
export const GET_REPOSITORY_CATEGORY = "Code Host";
export const GET_REPOSITORY_DESCRIPTION =
  "Fetch metadata for a remote repository.";

export const getRepositoryInputFields: InputFields = {
  owner: { type: "string", label: "Owner / org", required: true },
  repo:  { type: "string", label: "Repository", required: true },
};
