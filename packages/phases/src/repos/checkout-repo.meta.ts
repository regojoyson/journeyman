import type { OutputSchema } from "@journeyman/core";
import type { InputFields } from "../shared-meta.ts";

export const CHECKOUT_REPO_PHASE_TYPE = "checkout-repo";
export const CHECKOUT_REPO_LABEL = "Checkout Repo";
export const CHECKOUT_REPO_CATEGORY = "Repos";
export const checkoutRepoOutputSchema: OutputSchema = {
  dirPath: { type: "string", description: "Local directory the repo was cloned into" },
  branch: { type: "string" },
  commitSha: { type: "string" },
};

export const checkoutRepoInputFields: InputFields = {
  url:          { type: "string", label: "URL", required: true },
  branch:       { type: "string", label: "Branch" },
  workspaceDir: { type: "string", label: "Workspace dir", required: true, bindOnly: true },
};
