import type { StepDefinition } from "@journeyman/flow-editor";
import {
  LIST_PULL_REQUESTS_STEP_TYPE,
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

export const listPullRequestsStep: StepDefinition<ListPullRequestsConfig> = {
  stepType: LIST_PULL_REQUESTS_STEP_TYPE,
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
  tabs: { io: "shown", mcp: "hidden", retry: "shown", requiredSecrets: "hidden" },
  summary: c => c.owner && c.repo ? `${c.owner}/${c.repo} [${c.state}]` : "",
  executor: { kind: "git-provider", method: "listPRs" },
  comingSoon: true,
};
