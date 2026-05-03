import type { OutputSchema, InputFields } from "@journeyman/core";

export const START_FEATURE_BRANCH_PHASE_TYPE = "start-feature-branch";
export const START_FEATURE_BRANCH_LABEL = "Start Feature Branch";
export const START_FEATURE_BRANCH_CATEGORY = "Workspace";
export const START_FEATURE_BRANCH_DESCRIPTION =
  "Sync already-cloned repos to origin (hard-reset to the base branch), then create one shared feature branch across all of them. The branch name is generated from the issue.";

export const startFeatureBranchOutputSchema: OutputSchema = {
  newBranch: { type: "string" },
  repos:     { type: "array", items: { type: "ref", name: "Repo" }, description: "Array of Repo per cloned repository" },
};

export const startFeatureBranchInputFields: InputFields = {
  repos: { shape: { type: "array", items: { type: "ref", name: "Repo" } }, label: "Repos", required: true, bindOnly: true },
  issue: { shape: { type: "ref", name: "Issue" }, label: "Issue", bindOnly: true },
};
