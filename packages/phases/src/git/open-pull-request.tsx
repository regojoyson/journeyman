import { z } from "zod";
import type { PhaseDefinition } from "@journeyman/flow-editor";
import {
  OPEN_PULL_REQUEST_PHASE_TYPE,
  OPEN_PULL_REQUEST_LABEL,
  OPEN_PULL_REQUEST_CATEGORY,
  OPEN_PULL_REQUEST_DESCRIPTION,
} from "./open-pull-request.meta.ts";

interface OpenPullRequestConfig {
  title: string;
  body?: string;
  sourceBranch?: string;
}

export const openPullRequestPhase: PhaseDefinition<OpenPullRequestConfig> = {
  phaseType: OPEN_PULL_REQUEST_PHASE_TYPE,
  label: OPEN_PULL_REQUEST_LABEL,
  category: OPEN_PULL_REQUEST_CATEGORY,
  description: OPEN_PULL_REQUEST_DESCRIPTION,
  color: "#74b9ff",
  icon: "🔀",
  defaultConfig: { title: "", body: "", sourceBranch: "" },
  configSchema: z.object({
    title: z.string().min(1),
    body: z.string().optional(),
    sourceBranch: z.string().optional(),
  }),
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
