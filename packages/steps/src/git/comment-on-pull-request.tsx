import type { StepDefinition } from "@journeyman/flow-editor";
import {
  COMMENT_ON_PULL_REQUEST_STEP_TYPE,
  COMMENT_ON_PULL_REQUEST_LABEL,
  COMMENT_ON_PULL_REQUEST_CATEGORY,
  COMMENT_ON_PULL_REQUEST_DESCRIPTION,
  commentOnPullRequestConfigSchema,
} from "./comment-on-pull-request.meta.ts";

interface CommentOnPullRequestConfig {
  owner: string;
  repo: string;
  prNumber: number | "";
  template: string;
  body?: string;
}

export const commentOnPullRequestStep: StepDefinition<CommentOnPullRequestConfig> = {
  stepType: COMMENT_ON_PULL_REQUEST_STEP_TYPE,
  label: COMMENT_ON_PULL_REQUEST_LABEL,
  category: COMMENT_ON_PULL_REQUEST_CATEGORY,
  description: COMMENT_ON_PULL_REQUEST_DESCRIPTION,
  color: "#74b9ff",
  icon: "💬",
  defaultConfig: { owner: "", repo: "", prNumber: "", template: "", body: "" },
  configSchema: commentOnPullRequestConfigSchema,
  configFields: {
    owner:    { label: "Owner / org", widget: "text" },
    repo:     { label: "Repository", widget: "text" },
    prNumber: { label: "PR number", widget: "number", help: "Leave blank to resolve from upstream step" },
    template: { label: "Template id", widget: "text", help: "e.g. plan-summary, pr-opened" },
    body:     { label: "Inline body (optional)", widget: "textarea" },
  },
  tabs: { io: "shown", mcp: "hidden", retry: "shown" },
  slots: [
    {
      name: "GITHUB_ACCESS_TOKEN",
      description: "GitHub PAT with repo and project scopes — used to call the GitHub API.",
    },
  ],
  summary: c => c.template || (c.prNumber ? `#${c.prNumber}` : "(no target)"),
  executor: { kind: "git-provider", method: "addComment" },
  comingSoon: true,
};
