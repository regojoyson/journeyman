import type { OutputSchema } from "@journeyman/core";
import type { InputFields } from "../shared-meta.ts";

export const SCAN_REPOS_PHASE_TYPE = "scan-repos";
export const SCAN_REPOS_LABEL = "Scan Repos";
export const SCAN_REPOS_CATEGORY = "Repos";
export const scanReposOutputSchema: OutputSchema = {
  files: { type: "string[]" },
  fileCount: { type: "number" },
};

export const scanReposInputFields: InputFields = {
  pattern:      { type: "string", label: "Pattern" },
  workspaceDir: { type: "string", label: "Workspace dir", required: true, bindOnly: true },
};
