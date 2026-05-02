import type { InputFields } from "../shared-meta.ts";

export const CLONE_REPOS_PHASE_TYPE = "clone-repos";
export const CLONE_REPOS_LABEL = "Clone Repos";
export const CLONE_REPOS_CATEGORY = "Code Host";
export const CLONE_REPOS_DESCRIPTION =
  "Bulk-clone repositories from the code host into a target directory using host credentials.";

export const cloneReposInputFields: InputFields = {
  repos:        { type: "string", label: "Repos", required: true },
  workspaceDir: { type: "string", label: "Workspace directory", required: true, bindOnly: true },
};
