import type { OutputSchema } from "@journeyman/core";
import type { InputFields } from "../shared-meta.ts";

export const COMMIT_AND_PUSH_PHASE_TYPE = "commit-and-push";
export const COMMIT_AND_PUSH_LABEL = "Commit & Push";
export const COMMIT_AND_PUSH_CATEGORY = "Workspace";
export const COMMIT_AND_PUSH_DESCRIPTION =
  "Stage all changes, commit, and push to the remote branch.";

export const commitAndPushOutputSchema: OutputSchema = {
  commitSha: { type: "string" },
  pushed: { type: "boolean" },
};

export const commitAndPushInputFields: InputFields = {
  repoPath: { type: "string", label: "Repo path", required: true },
  message:  { type: "string", label: "Message", required: true },
  branch:   { type: "string", label: "Branch" },
};
