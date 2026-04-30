// packages/phases/src/git/clone-repos.tsx
import { z } from "zod";
import type { PhaseDefinition } from "@journeyman/flow-editor";
import {
  CLONE_REPOS_PHASE_TYPE,
  CLONE_REPOS_LABEL,
  CLONE_REPOS_CATEGORY,
  CLONE_REPOS_DESCRIPTION,
} from "./clone-repos.meta.ts";

interface CloneReposConfig {
  repos: string;
}

export const cloneReposPhase: PhaseDefinition<CloneReposConfig> = {
  phaseType: CLONE_REPOS_PHASE_TYPE,
  label: CLONE_REPOS_LABEL,
  category: CLONE_REPOS_CATEGORY,
  description: CLONE_REPOS_DESCRIPTION,
  color: "#74b9ff",
  icon: "📦",
  defaultConfig: { repos: "" },
  configSchema: z.object({
    repos: z.string().min(1),
  }),
  configFields: {
    repos:     { label: "Repos", widget: "textarea", help: "One owner/repo (or URL) per line" },
  },
  tabs: { io: "shown", credentials: "required", mcp: "hidden", retry: "shown" },
  defaultRequiredSecrets: ["GITHUB_ACCESS_TOKEN"],
  summary: c => {
    const lines = c.repos.split("\n").filter(s => s.trim());
    return lines.length ? `${lines.length} repo${lines.length === 1 ? "" : "s"}` : "(no repos)";
  },
  executor: { kind: "git-provider", method: "cloneRepos" },
};
