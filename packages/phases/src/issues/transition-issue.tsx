import { z } from "zod";
import type { PhaseDefinition } from "@journeyman/flow-editor";
import {
  TRANSITION_ISSUE_PHASE_TYPE,
  TRANSITION_ISSUE_LABEL,
  TRANSITION_ISSUE_CATEGORY,
  TRANSITION_ISSUE_DESCRIPTION,
  transitionIssueOutputSchema,
} from "./transition-issue.meta.ts";

interface TransitionIssueConfig {
  issueRef: string;
  status: string;
}

export const transitionIssuePhase: PhaseDefinition<TransitionIssueConfig> = {
  phaseType: TRANSITION_ISSUE_PHASE_TYPE,
  label: TRANSITION_ISSUE_LABEL,
  category: TRANSITION_ISSUE_CATEGORY,
  description: TRANSITION_ISSUE_DESCRIPTION,
  color: "#a29bfe",
  icon: "🚦",
  defaultConfig: { issueRef: "", status: "" },
  configSchema: z.object({
    issueRef: z.string().min(1),
    status: z.string().min(1),
  }),
  configFields: {
    issueRef: { label: "Issue ref", widget: "text", help: "Supports #{issue} placeholder" },
    status:    { label: "Target status", widget: "text", help: "e.g. development-started, code-review, completed" },
  },
  tabs: { io: "shown", mcp: "hidden", retry: "shown" },
  slots: [
    {
      name: "GITHUB_ACCESS_TOKEN",
      description: "GitHub PAT with repo and project scopes — used to call the GitHub API.",
    },
  ],
  summary: c => c.status || "(no status)",
  executor: { kind: "issue-provider", method: "updateStatus" },
  outputSchema: transitionIssueOutputSchema,
};
