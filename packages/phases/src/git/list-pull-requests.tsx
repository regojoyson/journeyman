import type { PhaseDefinition } from "@journeyman/flow-editor";
import {
  LIST_PULL_REQUESTS_PHASE_TYPE,
  LIST_PULL_REQUESTS_LABEL,
  LIST_PULL_REQUESTS_CATEGORY,
  LIST_PULL_REQUESTS_DESCRIPTION,
  listPullRequestsConfigSchema,
} from "./list-pull-requests.meta.ts";

interface ListPullRequestsConfig {
  owner: string;
  repo: string;
  state: "open" | "closed" | "all";
}

export const listPullRequestsPhase: PhaseDefinition<ListPullRequestsConfig> = {
  phaseType: LIST_PULL_REQUESTS_PHASE_TYPE,
  label: LIST_PULL_REQUESTS_LABEL,
  category: LIST_PULL_REQUESTS_CATEGORY,
  description: LIST_PULL_REQUESTS_DESCRIPTION,
  color: "#74b9ff",
  icon: "📋",
  defaultConfig: { owner: "", repo: "", state: "open" },
  configSchema: listPullRequestsConfigSchema,
  configFields: {
    owner: { label: "Owner / org", widget: "text" },
    repo:  { label: "Repository", widget: "text" },
    state: {
      label: "State", widget: "select",
      options: [
        { value: "open",   label: "Open"   },
        { value: "closed", label: "Closed" },
        { value: "all",    label: "All"    },
      ],
    },
  },
  tabs: { io: "shown", mcp: "hidden", retry: "shown" },
  slots: [
    {
      name: "GITHUB_ACCESS_TOKEN",
      description: "GitHub PAT with repo and project scopes — used to call the GitHub API.",
    },
  ],
  summary: c => c.owner && c.repo ? `${c.owner}/${c.repo} [${c.state}]` : "",
  executor: { kind: "git-provider", method: "listPRs" },
  comingSoon: true,
};
