import { z } from "zod";
import type { OutputSchema, InputFields } from "@journeyman/core";

export const createWorkspaceConfigSchema = z.object({
  ref: z.string().min(1),
});

export const CREATE_WORKSPACE_STEP_TYPE = "create-workspace";
export const CREATE_WORKSPACE_LABEL = "Create Workspace";
export const CREATE_WORKSPACE_CATEGORY = "Workspace";
export const CREATE_WORKSPACE_DESCRIPTION =
  "Create a new local directory to hold repositories for this run.";

export const createWorkspaceOutputSchema: OutputSchema = {
  workspaceDir: { type: "string" },
  folderName:   { type: "string" },
};

export const createWorkspaceInputFields: InputFields = {
  ref: { shape: { type: "string" }, label: "Ref", required: true },
};
