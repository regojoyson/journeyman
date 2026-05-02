import type { OutputSchema } from "@journeyman/core";
import type { InputFields } from "../shared-meta.ts";

export const START_FEATURE_BRANCH_PHASE_TYPE = "start-feature-branch";
export const START_FEATURE_BRANCH_LABEL = "Start Feature Branch";
export const START_FEATURE_BRANCH_CATEGORY = "Workspace";
export const START_FEATURE_BRANCH_DESCRIPTION =
  "Sync already-cloned repos to origin (hard-reset to the base branch), then create one shared feature branch across all of them. The branch name is generated from the ticket.";

export const startFeatureBranchOutputSchema: OutputSchema = {
  newBranch: { type: "string" },
  repos:     { type: "string", description: "Array of { repoDir, branch, newBranch } per repo" },
};

export const startFeatureBranchInputFields: InputFields = {
  repos:  { type: "string", label: "Repos", required: true, bindOnly: true },
  ticket: { type: "string", label: "Ticket", bindOnly: true },
};
