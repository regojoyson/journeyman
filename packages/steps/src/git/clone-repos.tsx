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
  repos: { url: string; branch?: string }[];
}

export const cloneReposStep: StepDefinition<CloneReposConfig> = {
  stepType: CLONE_REPOS_STEP_TYPE,
  label: CLONE_REPOS_LABEL,
  category: CLONE_REPOS_CATEGORY,
  description: CLONE_REPOS_DESCRIPTION,
  color: "#74b9ff",
  icon: "📦",
  defaultConfig: { repos: [] },
  configSchema: cloneReposConfigSchema,
  // Repos (and their per-repo branch) are edited by the connection-bound RepoPicker
  // in the flow-editor, not by generic widgets. An empty configFields also disables
  // the ConfigTab stale-key sweep for this step, so config.repos is never wiped.
  configFields: {},
  tabs: { io: "shown", mcp: "hidden", retry: "shown", requiredSecrets: "hidden" },
  summary: c => {
    const n = Array.isArray(c.repos) ? c.repos.length : 0;
    return n ? `${n} repo${n === 1 ? "" : "s"}` : "(no repos)";
  },
  executor: { kind: "git-provider", method: "cloneRepos" },
};
