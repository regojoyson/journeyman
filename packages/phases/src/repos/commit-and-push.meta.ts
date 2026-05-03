import type { OutputSchema, InputFields } from "@journeyman/core";

export const COMMIT_AND_PUSH_PHASE_TYPE = "commit-and-push";
export const COMMIT_AND_PUSH_LABEL = "Commit & Push";
export const COMMIT_AND_PUSH_CATEGORY = "Workspace";
export const COMMIT_AND_PUSH_DESCRIPTION =
  "Stage all changes, commit, and push to the remote branch.";

export const commitAndPushOutputSchema: OutputSchema = {
  commitSha: { type: "string" },
  pushed:    { type: "boolean" },
  repos:     { type: "array", items: { type: "ref", name: "Repo" } },
};

export const commitAndPushInputFields: InputFields = {
  repos:   { shape: { type: "array", items: { type: "ref", name: "Repo" } }, label: "Repos", bindOnly: true },
  message: { shape: { type: "string" }, label: "Commit message (literal override)" },
  issue:   { shape: { type: "string" }, label: "Issue (commit subject)" },
  pattern: { shape: { type: "string" }, label: "Message pattern (e.g. {issue} : {summary})" },
};
