// packages/steps/src/git/clone-repos.tsx
import type { StepDefinition } from "@journeyman/flow-editor";
import {
  CLONE_REPOS_STEP_TYPE,
  CLONE_REPOS_LABEL,
  CLONE_REPOS_CATEGORY,
  CLONE_REPOS_DESCRIPTION,
  cloneReposConfigSchema,
} from "./clone-repos.meta.ts";

interface CloneReposConfig {
  repos: string;
  branch?: string;
}

export const cloneReposStep: StepDefinition<CloneReposConfig> = {
  stepType: CLONE_REPOS_STEP_TYPE,
  label: CLONE_REPOS_LABEL,
  category: CLONE_REPOS_CATEGORY,
  description: CLONE_REPOS_DESCRIPTION,
  color: "#74b9ff",
  icon: "📦",
  defaultConfig: { repos: "", branch: "" },
  configSchema: cloneReposConfigSchema,
  configFields: {
    repos:  { label: "Repos",  widget: "string-list", help: "One owner/repo or URL per row" },
    branch: { label: "Branch", widget: "text",        help: "Optional — defaults to main" },
  },
  tabs: { io: "shown", mcp: "hidden", retry: "shown", requiredSecrets: "hidden" },
  summary: c => {
    const lines = (c.repos ?? "").split("\n").filter(s => s.trim());
    return lines.length ? `${lines.length} repo${lines.length === 1 ? "" : "s"}` : "(no repos)";
  },
  executor: { kind: "git-provider", method: "cloneRepos" },
};
