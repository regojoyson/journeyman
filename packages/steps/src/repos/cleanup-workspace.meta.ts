import { z } from "zod";
import type { OutputSchema, InputFields } from "@journeyman/core";

export const cleanupWorkspaceConfigSchema = z.object({
  mode: z.enum(["soft", "hard"]),
});

export const CLEANUP_WORKSPACE_STEP_TYPE = "cleanup-workspace";
export const CLEANUP_WORKSPACE_LABEL = "Cleanup Workspace";
export const CLEANUP_WORKSPACE_CATEGORY = "Workspace";
export const CLEANUP_WORKSPACE_DESCRIPTION =
  "Reset and optionally delete repositories in a workspace.";

export const cleanupWorkspaceOutputSchema: OutputSchema = {
  removed: { type: "boolean" },
};

export const cleanupWorkspaceInputFields: InputFields = {
  mode:         { shape: { type: "string" }, label: "Mode" },
  workspaceDir: { shape: { type: "string" }, label: "Workspace dir", required: true, bindOnly: true },
};
