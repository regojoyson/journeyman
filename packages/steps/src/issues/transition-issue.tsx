import type { StepDefinition } from "@journeyman/flow-editor";
import {
  TRANSITION_ISSUE_STEP_TYPE,
  TRANSITION_ISSUE_LABEL,
  TRANSITION_ISSUE_CATEGORY,
  TRANSITION_ISSUE_DESCRIPTION,
  transitionIssueOutputSchema,
  transitionIssueConfigSchema,
} from "./transition-issue.meta.ts";

interface TransitionIssueConfig {
  ref: string;
  status: string;
}

export const transitionIssueStep: StepDefinition<TransitionIssueConfig> = {
  stepType: TRANSITION_ISSUE_STEP_TYPE,
  label: TRANSITION_ISSUE_LABEL,
  category: TRANSITION_ISSUE_CATEGORY,
  description: TRANSITION_ISSUE_DESCRIPTION,
  color: "#a29bfe",
  icon: "🚦",
  defaultConfig: { ref: "", status: "" },
  configSchema: transitionIssueConfigSchema,
  configFields: {
    ref: { label: "Ref", widget: "text", help: "Supports #{issue} placeholder" },
    status:    { label: "Target status", widget: "text", help: "e.g. development-started, code-review, completed" },
  },
  tabs: { io: "shown", mcp: "hidden", retry: "shown" },
  summary: c => c.status || "(no status)",
  executor: { kind: "issue-provider", method: "updateStatus" },
  outputSchema: transitionIssueOutputSchema,
  comingSoon: true,
};
