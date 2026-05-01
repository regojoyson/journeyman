import { z } from "zod";
import type { PhaseDefinition } from "@journeyman/flow-editor";
import {
  LIST_PULL_REQUEST_COMMENTS_PHASE_TYPE,
  LIST_PULL_REQUEST_COMMENTS_LABEL,
  LIST_PULL_REQUEST_COMMENTS_CATEGORY,
  LIST_PULL_REQUEST_COMMENTS_DESCRIPTION,
} from "./list-pull-request-comments.meta.ts";

interface ListPullRequestCommentsConfig {
  owner: string;
  repo: string;
  prNumber: number | "";
}

export const listPullRequestCommentsPhase: PhaseDefinition<ListPullRequestCommentsConfig> = {
  phaseType: LIST_PULL_REQUEST_COMMENTS_PHASE_TYPE,
  label: LIST_PULL_REQUEST_COMMENTS_LABEL,
  category: LIST_PULL_REQUEST_COMMENTS_CATEGORY,
  description: LIST_PULL_REQUEST_COMMENTS_DESCRIPTION,
  color: "#74b9ff",
  icon: "📨",
  defaultConfig: { owner: "", repo: "", prNumber: "" },
  configSchema: z.object({
    owner: z.string().min(1),
    repo: z.string().min(1),
    prNumber: z.union([z.number(), z.literal("")]),
  }),
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
};
