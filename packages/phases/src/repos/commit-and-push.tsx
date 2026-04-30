import { z } from "zod";
import type { PhaseDefinition } from "@journeyman/flow-editor";
import {
  COMMIT_AND_PUSH_PHASE_TYPE,
  COMMIT_AND_PUSH_LABEL,
  COMMIT_AND_PUSH_CATEGORY,
  COMMIT_AND_PUSH_DESCRIPTION,
  commitAndPushOutputSchema,
} from "./commit-and-push.meta.ts";

interface CommitAndPushConfig {
  repoPath: string;
  message: string;
  branch?: string;
}

export const commitAndPushPhase: PhaseDefinition<CommitAndPushConfig> = {
  phaseType: COMMIT_AND_PUSH_PHASE_TYPE,
  label: COMMIT_AND_PUSH_LABEL,
  category: COMMIT_AND_PUSH_CATEGORY,
  description: COMMIT_AND_PUSH_DESCRIPTION,
  color: "#fdcb6e",
  icon: "⬆",
  defaultConfig: { repoPath: "", message: "", branch: "" },
  configSchema: z.object({
    repoPath: z.string().min(1),
    message: z.string().min(1),
    branch: z.string().optional(),
  }),
  configFields: {
    repoPath: { label: "Repo path", widget: "text" },
    message:  { label: "Commit message", widget: "textarea" },
    branch:   { label: "Branch", widget: "text", help: "Defaults to current branch" },
  },
  tabs: { io: "shown", credentials: "hidden", requiredSecrets: "shown", mcp: "hidden", retry: "shown" },
  defaultRequiredSecrets: ["GITHUB_ACCESS_TOKEN"],
  summary: c => c.message ? `"${c.message.slice(0, 40)}"` : c.repoPath,
  executor: { kind: "coding-cli", method: "commitPushRepos" },
  outputSchema: commitAndPushOutputSchema,
};
