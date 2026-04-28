import type { InputFields } from "../shared-meta.ts";

export const CLONE_REPOS_PHASE_TYPE = "clone-repos";
export const CLONE_REPOS_LABEL = "Clone Repos";
export const CLONE_REPOS_CATEGORY = "Git";

export const cloneReposInputFields: InputFields = {
  repos:     { type: "string", label: "Repos", required: true },
  targetDir: { type: "string", label: "Target dir", required: true, bindOnly: true },
};
