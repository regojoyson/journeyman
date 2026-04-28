import type { OutputSchema } from "@journeyman/core";
import type { InputFields } from "../shared-meta.ts";

export const CREATE_WORKSPACE_PHASE_TYPE = "create-workspace";
export const CREATE_WORKSPACE_LABEL = "Create Workspace";
export const CREATE_WORKSPACE_CATEGORY = "Repos";
export const createWorkspaceOutputSchema: OutputSchema = {
  workspaceDir: { type: "string" },
};

export const createWorkspaceInputFields: InputFields = {
  name:    { type: "string", label: "Name" },
  baseDir: { type: "string", label: "Base dir" },
};
