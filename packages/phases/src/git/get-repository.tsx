import { z } from "zod";
import type { PhaseDefinition } from "@journeyman/flow-editor";
import {
  GET_REPOSITORY_PHASE_TYPE,
  GET_REPOSITORY_LABEL,
  GET_REPOSITORY_CATEGORY,
  GET_REPOSITORY_DESCRIPTION,
} from "./get-repository.meta.ts";

interface GetRepositoryConfig {
  owner: string;
  repo: string;
}

export const getRepositoryPhase: PhaseDefinition<GetRepositoryConfig> = {
  phaseType: GET_REPOSITORY_PHASE_TYPE,
  label: GET_REPOSITORY_LABEL,
  category: GET_REPOSITORY_CATEGORY,
  description: GET_REPOSITORY_DESCRIPTION,
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
  tabs: { io: "shown", mcp: "hidden", retry: "shown" },
  slots: [
    {
      name: "GITHUB_ACCESS_TOKEN",
      description: "GitHub PAT with repo and project scopes — used to call the GitHub API.",
    },
  ],
  summary: c => c.owner && c.repo ? `${c.owner}/${c.repo}` : "",
  executor: { kind: "git-provider", method: "getRepo" },
};
