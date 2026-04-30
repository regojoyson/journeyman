import type { OutputSchema } from "@journeyman/core";
import type { InputFields } from "../shared-meta.ts";

export const LIST_WORKSPACE_FILES_PHASE_TYPE = "list-workspace-files";
export const LIST_WORKSPACE_FILES_LABEL = "List Workspace Files";
export const LIST_WORKSPACE_FILES_CATEGORY = "Workspace";
export const LIST_WORKSPACE_FILES_DESCRIPTION =
  "List files in a workspace directory matching a glob pattern.";

export const listWorkspaceFilesOutputSchema: OutputSchema = {
  files: { type: "string[]" },
  fileCount: { type: "number" },
};

export const listWorkspaceFilesInputFields: InputFields = {
  pattern:      { type: "string", label: "Pattern" },
  workspaceDir: { type: "string", label: "Workspace dir", required: true, bindOnly: true },
};
