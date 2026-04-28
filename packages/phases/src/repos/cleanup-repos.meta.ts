import type { OutputSchema } from "@journeyman/core";
import type { InputFields } from "../shared-meta.ts";

export const CLEANUP_REPOS_PHASE_TYPE = "cleanup-repos";
export const CLEANUP_REPOS_LABEL = "Cleanup Repos";
export const CLEANUP_REPOS_CATEGORY = "Repos";
export const cleanupReposOutputSchema: OutputSchema = {
  removed: { type: "boolean" },
};

export const cleanupReposInputFields: InputFields = {
  mode:         { type: "string", label: "Mode" },
  workspaceDir: { type: "string", label: "Workspace dir", required: true, bindOnly: true },
};
