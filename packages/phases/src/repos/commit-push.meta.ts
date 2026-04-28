import type { OutputSchema } from "@journeyman/core";
import type { InputFields } from "../shared-meta.ts";

export const COMMIT_PUSH_PHASE_TYPE = "commit-push";
export const COMMIT_PUSH_LABEL = "Commit & Push";
export const COMMIT_PUSH_CATEGORY = "Repos";
export const commitPushOutputSchema: OutputSchema = {
  commitSha: { type: "string" },
  pushed: { type: "boolean" },
};

export const commitPushInputFields: InputFields = {
  repoPath: { type: "string", label: "Repo path", required: true },
  message:  { type: "string", label: "Message", required: true },
  branch:   { type: "string", label: "Branch" },
};
