import { z } from "zod";
import type { OutputSchema, InputFields } from "@journeyman/core";

export const listWorkspaceFilesConfigSchema = z.object({
  pattern: z.string().min(1),
});

export const LIST_WORKSPACE_FILES_PHASE_TYPE = "list-workspace-files";
export const LIST_WORKSPACE_FILES_LABEL = "List Workspace Files";
export const LIST_WORKSPACE_FILES_CATEGORY = "Workspace";
export const LIST_WORKSPACE_FILES_DESCRIPTION =
  "List files in a workspace directory matching a glob pattern.";

export const listWorkspaceFilesOutputSchema: OutputSchema = {
  files:     { type: "array", items: { type: "string" } },
  fileCount: { type: "number" },
};

export const listWorkspaceFilesInputFields: InputFields = {
  pattern:      { shape: { type: "string" }, label: "Pattern" },
  workspaceDir: { shape: { type: "string" }, label: "Workspace dir", required: true, bindOnly: true },
};
