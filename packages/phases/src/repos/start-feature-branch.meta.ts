import type { OutputSchema } from "@journeyman/core";
import type { InputFields } from "../shared-meta.ts";

export const START_FEATURE_BRANCH_PHASE_TYPE = "start-feature-branch";
export const START_FEATURE_BRANCH_LABEL = "Start Feature Branch";
export const START_FEATURE_BRANCH_CATEGORY = "Workspace";
export const START_FEATURE_BRANCH_DESCRIPTION =
  "Sync already-cloned repos to origin (hard-reset to the base branch), then create one shared feature branch across all of them. The branch name is generated from the ticket.";

export const startFeatureBranchOutputSchema: OutputSchema = {
  dirPath: { type: "string", description: "Local directory the repo was cloned into" },
  branch: { type: "string" },
  commitSha: { type: "string" },
};

export const startFeatureBranchInputFields: InputFields = {
  url:          { type: "string", label: "URL", required: true },
  branch:       { type: "string", label: "Branch" },
  workspaceDir: { type: "string", label: "Workspace dir", required: true, bindOnly: true },
};
