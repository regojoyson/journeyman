// packages/phases/src/git/get-repo.tsx
import { z } from "zod";
import type { PhaseDefinition } from "@journeyman/flow-editor";
import { GET_REPO_PHASE_TYPE, GET_REPO_LABEL, GET_REPO_CATEGORY } from "./get-repo.meta.ts";

interface GetRepoConfig {
  owner: string;
  repo: string;
}

export const getRepoPhase: PhaseDefinition<GetRepoConfig> = {
  phaseType: GET_REPO_PHASE_TYPE,
  label: GET_REPO_LABEL,
  category: GET_REPO_CATEGORY,
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
