// packages/phases/src/repos/commit-push.tsx
import { z } from "zod";
import type { PhaseDefinition } from "@journeyman/flow-editor";
import {
  COMMIT_PUSH_PHASE_TYPE,
  COMMIT_PUSH_LABEL,
  COMMIT_PUSH_CATEGORY,
  commitPushOutputSchema,
} from "./commit-push.meta.ts";

interface CommitPushConfig {
  repoPath: string;
  message: string;
  branch?: string;
}

export const commitPushPhase: PhaseDefinition<CommitPushConfig> = {
  phaseType: COMMIT_PUSH_PHASE_TYPE,
  label: COMMIT_PUSH_LABEL,
  category: COMMIT_PUSH_CATEGORY,
  description: "Stage all changes, commit, and push to remote.",
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
  tabs: { io: "shown", credentials: "hidden", mcp: "hidden", retry: "shown" },
  summary: c => c.message ? `"${c.message.slice(0, 40)}"` : c.repoPath,
  executor: { kind: "coding-cli", method: "commitPushRepos" },
  outputSchema: commitPushOutputSchema,
};
