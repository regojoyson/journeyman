// packages/phases/src/git/get-repo.tsx
import { z } from "zod";
import type { PhaseDefinition } from "@journeyman/flow-editor";

interface GetRepoConfig {
  owner: string;
  repo: string;
}

export const getRepoPhase: PhaseDefinition<GetRepoConfig> = {
  phaseType: "get-repo",
  label: "Get Repo",
  category: "Git",
  description: "Fetch metadata for a remote repository.",
  color: "#74b9ff",
  icon: "🗂",
  defaultConfig: { owner: "", repo: "" },
  configSchema: z.object({
    owner: z.string().min(1),
    repo: z.string().min(1),
  }),
  configFields: {
    owner: { label: "Owner / org", widget: "text" },
    repo:  { label: "Repository",  widget: "text" },
  },
  tabs: { io: "shown", credentials: "required", mcp: "hidden", retry: "shown" },
  summary: c => c.owner && c.repo ? `${c.owner}/${c.repo}` : "",
  executor: { kind: "git-provider", method: "getRepo" },
};
