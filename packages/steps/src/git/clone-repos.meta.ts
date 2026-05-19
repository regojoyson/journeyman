import { z } from "zod";
import type { OutputSchema, InputFields } from "@journeyman/core";

export const cloneReposConfigSchema = z.object({
  repos: z.string().min(1),
  branch: z.string().optional(),
});

export const CLONE_REPOS_STEP_TYPE = "clone-repos";
export const CLONE_REPOS_LABEL = "Clone Repos";
export const CLONE_REPOS_CATEGORY = "Code Host";
export const CLONE_REPOS_DESCRIPTION =
  "Bulk-clone repositories from the code host into a target directory using host credentials.";

export const cloneReposOutputSchema: OutputSchema = {
  repos: { type: "array", items: { type: "ref", name: "Repo" }, description: "Cloned repos with checkout dirs and base branches" },
};

export const cloneReposInputFields: InputFields = {
  repos:        { shape: { type: "array", items: { type: "string" } }, label: "Repos", required: true },
  workspaceDir: { shape: { type: "string" }, label: "Workspace directory", required: true, bindOnly: true },
  branch:       { shape: { type: "string" }, label: "Branch" },
};
