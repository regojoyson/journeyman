import type { OutputSchema } from "@journeyman/core";
import type { InputFields } from "../shared-meta.ts";

export const CLEANUP_WORKSPACE_PHASE_TYPE = "cleanup-workspace";
export const CLEANUP_WORKSPACE_LABEL = "Cleanup Workspace";
export const CLEANUP_WORKSPACE_CATEGORY = "Workspace";
export const CLEANUP_WORKSPACE_DESCRIPTION =
  "Reset and optionally delete repositories in a workspace.";

export const cleanupWorkspaceOutputSchema: OutputSchema = {
  removed: { type: "boolean" },
};

export const cleanupWorkspaceInputFields: InputFields = {
  mode:         { type: "string", label: "Mode" },
  workspaceDir: { type: "string", label: "Workspace dir", required: true, bindOnly: true },
};
