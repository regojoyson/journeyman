import { z } from "zod";
import type { PhaseDefinition } from "@journeyman/flow-editor";
import {
  LIST_PULL_REQUESTS_PHASE_TYPE,
  LIST_PULL_REQUESTS_LABEL,
  LIST_PULL_REQUESTS_CATEGORY,
  LIST_PULL_REQUESTS_DESCRIPTION,
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
  configSchema: z.object({
    owner: z.string().min(1),
    repo: z.string().min(1),
    state: z.enum(["open", "closed", "all"]),
  }),
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
  tabs: { io: "shown", credentials: "required", mcp: "hidden", retry: "shown" },
  defaultRequiredSecrets: ["GITHUB_ACCESS_TOKEN"],
  summary: c => c.owner && c.repo ? `${c.owner}/${c.repo} [${c.state}]` : "",
  executor: { kind: "git-provider", method: "listPRs" },
};
