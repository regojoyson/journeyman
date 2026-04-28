// packages/phases/src/git/fetch-pr-comments.tsx
import { z } from "zod";
import type { PhaseDefinition } from "@journeyman/flow-editor";

interface FetchPrCommentsConfig {
  owner: string;
  repo: string;
  prNumber: number | "";
}

export const fetchPrCommentsPhase: PhaseDefinition<FetchPrCommentsConfig> = {
  phaseType: "fetch-pr-comments",
  label: "Fetch PR Comments",
  category: "Git",
  description: "Read all comments from a pull/merge request.",
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
  tabs: { io: "shown", credentials: "required", mcp: "hidden", retry: "shown" },
  summary: c => c.owner && c.repo ? `${c.owner}/${c.repo}#${c.prNumber || "?"}` : "",
  executor: { kind: "git-provider", method: "fetchPRComments" },
};
