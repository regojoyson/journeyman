import { z } from "zod";
import type { PhaseDefinition } from "@journeyman/flow-editor";
import {
  OPEN_PULL_REQUEST_PHASE_TYPE,
  OPEN_PULL_REQUEST_LABEL,
  OPEN_PULL_REQUEST_CATEGORY,
  OPEN_PULL_REQUEST_DESCRIPTION,
} from "./open-pull-request.meta.ts";

interface OpenPullRequestConfig {
  owner: string;
  repo: string;
  title: string;
  body: string;
  head: string;
  base: string;
}

export const openPullRequestPhase: PhaseDefinition<OpenPullRequestConfig> = {
  phaseType: OPEN_PULL_REQUEST_PHASE_TYPE,
  label: OPEN_PULL_REQUEST_LABEL,
  category: OPEN_PULL_REQUEST_CATEGORY,
  description: OPEN_PULL_REQUEST_DESCRIPTION,
  color: "#74b9ff",
  icon: "🔀",
  defaultConfig: { owner: "", repo: "", title: "", body: "", head: "", base: "main" },
  configSchema: z.object({
    owner: z.string().min(1),
    repo: z.string().min(1),
    title: z.string().min(1),
    body: z.string(),
    head: z.string().min(1),
    base: z.string().min(1),
  }),
  configFields: {
    owner: { label: "Owner / org", widget: "text" },
    repo:  { label: "Repository", widget: "text" },
    title: { label: "Title", widget: "text" },
    body:  { label: "Body",  widget: "textarea" },
    head:  { label: "Head branch", widget: "text" },
    base:  { label: "Base branch", widget: "text" },
  },
  tabs: { io: "shown", mcp: "hidden", retry: "shown" },
  slots: [
    {
      name: "GITHUB_ACCESS_TOKEN",
      description: "GitHub PAT with repo and project scopes — used to call the GitHub API.",
    },
  ],
  summary: c => c.head && c.base ? `${c.base} ← ${c.head}` : (c.title || ""),
  executor: { kind: "git-provider", method: "createPR" },
};
