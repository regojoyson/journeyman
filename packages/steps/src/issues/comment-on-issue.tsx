import type { StepDefinition } from "@journeyman/flow-editor";
import {
  COMMENT_ON_ISSUE_STEP_TYPE,
  COMMENT_ON_ISSUE_LABEL,
  COMMENT_ON_ISSUE_CATEGORY,
  COMMENT_ON_ISSUE_DESCRIPTION,
  commentOnIssueOutputSchema,
  commentOnIssueConfigSchema,
} from "./comment-on-issue.meta.ts";

interface CommentOnIssueConfig {
  issueRef: string;
  template: string;
  body?: string;
}

export const commentOnIssueStep: StepDefinition<CommentOnIssueConfig> = {
  stepType: COMMENT_ON_ISSUE_STEP_TYPE,
  label: COMMENT_ON_ISSUE_LABEL,
  category: COMMENT_ON_ISSUE_CATEGORY,
  description: COMMENT_ON_ISSUE_DESCRIPTION,
  color: "#a29bfe",
  icon: "💭",
  defaultConfig: { issueRef: "", template: "", body: "" },
  configSchema: commentOnIssueConfigSchema,
  configFields: {
    issueRef: { label: "Issue ref", widget: "text", help: "Supports #{issue} placeholder" },
    template:  { label: "Template id", widget: "text", help: "e.g. analysis-summary, completion-summary" },
    body:      { label: "Inline body (optional)", widget: "textarea", help: "Used when no template is set" },
  },
  tabs: { io: "shown", mcp: "hidden", retry: "shown" },
  summary: c => c.template || c.issueRef || "(no target)",
  executor: { kind: "issue-provider", method: "addComment" },
  outputSchema: commentOnIssueOutputSchema,
  comingSoon: true,
};
