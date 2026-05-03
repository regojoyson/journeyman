import type { OutputSchema, InputFields } from "@journeyman/core";

export const CREATE_WORKSPACE_PHASE_TYPE = "create-workspace";
export const CREATE_WORKSPACE_LABEL = "Create Workspace";
export const CREATE_WORKSPACE_CATEGORY = "Workspace";
export const CREATE_WORKSPACE_DESCRIPTION =
  "Create a new local directory to hold repositories for this run.";

export const createWorkspaceOutputSchema: OutputSchema = {
  workspaceDir: { type: "string" },
  folderName:   { type: "string" },
};

export const createWorkspaceInputFields: InputFields = {
  issueRef: { shape: { type: "string" }, label: "Issue ref", required: true },
};
