import type { StepDefinition } from "@journeyman/flow-editor";
import {
  LIST_PULL_REQUEST_COMMENTS_STEP_TYPE,
  LIST_PULL_REQUEST_COMMENTS_LABEL,
  LIST_PULL_REQUEST_COMMENTS_CATEGORY,
  LIST_PULL_REQUEST_COMMENTS_DESCRIPTION,
  listPullRequestCommentsConfigSchema,
} from "./list-pull-request-comments.meta.ts";

interface ListPullRequestCommentsConfig {
  owner: string;
  repo: string;
  prNumber: number | "";
}

export const listPullRequestCommentsStep: StepDefinition<ListPullRequestCommentsConfig> = {
  stepType: LIST_PULL_REQUEST_COMMENTS_STEP_TYPE,
  label: LIST_PULL_REQUEST_COMMENTS_LABEL,
  category: LIST_PULL_REQUEST_COMMENTS_CATEGORY,
  description: LIST_PULL_REQUEST_COMMENTS_DESCRIPTION,
  color: "#74b9ff",
  icon: "📨",
  defaultConfig: { owner: "", repo: "", prNumber: "" },
  configSchema: listPullRequestCommentsConfigSchema,
  configFields: {
    owner:    { label: "Owner / org", widget: "text" },
    repo:     { label: "Repository", widget: "text" },
    prNumber: { label: "PR number", widget: "number", help: "Leave blank to resolve from upstream step" },
  },
  tabs: { io: "shown", mcp: "hidden", retry: "shown" },
  slots: [
    {
      name: "GITHUB_ACCESS_TOKEN",
      description: "GitHub PAT with repo and project scopes — used to call the GitHub API.",
    },
  ],
  summary: c => c.owner && c.repo ? `${c.owner}/${c.repo}#${c.prNumber || "?"}` : "",
  executor: { kind: "git-provider", method: "fetchPRComments" },
  comingSoon: true,
};
