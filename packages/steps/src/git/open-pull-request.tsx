import type { StepDefinition } from "@journeyman/flow-editor";
import {
  OPEN_PULL_REQUEST_STEP_TYPE,
  OPEN_PULL_REQUEST_LABEL,
  OPEN_PULL_REQUEST_CATEGORY,
  OPEN_PULL_REQUEST_DESCRIPTION,
  openPullRequestConfigSchema,
} from "./open-pull-request.meta.ts";

interface OpenPullRequestConfig {
  title: string;
  body?: string;
  sourceBranch?: string;
}

export const openPullRequestStep: StepDefinition<OpenPullRequestConfig> = {
  stepType: OPEN_PULL_REQUEST_STEP_TYPE,
  label: OPEN_PULL_REQUEST_LABEL,
  category: OPEN_PULL_REQUEST_CATEGORY,
  description: OPEN_PULL_REQUEST_DESCRIPTION,
  color: "#74b9ff",
  icon: "🔀",
  defaultConfig: { title: "", body: "", sourceBranch: "" },
  configSchema: openPullRequestConfigSchema,
  configFields: {
    title:        { label: "Title",         widget: "text" },
    body:         { label: "Body",          widget: "textarea" },
    sourceBranch: { label: "Source branch", widget: "text", help: "The feature branch to open the PR from. Typically ref'd from start-feature-branch.output.newBranch." },
  },
  tabs: { io: "shown", mcp: "hidden", retry: "shown" },
  slots: [
    {
      name: "GITHUB_ACCESS_TOKEN",
      description: "GitHub PAT with repo and project scopes — used to call the GitHub API.",
    },
  ],
  summary: c => c.sourceBranch ? `← ${c.sourceBranch}` : (c.title || ""),
  executor: { kind: "git-provider", method: "createPR" },
};
