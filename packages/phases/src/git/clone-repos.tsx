// packages/phases/src/git/clone-repos.tsx
import { z } from "zod";
import type { PhaseDefinition } from "@journeyman/flow-editor";

interface CloneReposConfig {
  repos: string;
  targetDir: string;
}

export const cloneReposPhase: PhaseDefinition<CloneReposConfig> = {
  phaseType: "clone-repos",
  label: "Clone Repos",
  category: "Git",
  description: "Bulk-clone multiple repositories into a target directory.",
  color: "#74b9ff",
  icon: "📦",
  defaultConfig: { repos: "", targetDir: "" },
  configSchema: z.object({
    repos: z.string().min(1),
    targetDir: z.string().min(1),
  }),
  configFields: {
    repos:     { label: "Repos", widget: "textarea", help: "One owner/repo (or URL) per line" },
    targetDir: { label: "Target directory", widget: "text" },
  },
  tabs: { io: "shown", credentials: "required", mcp: "hidden", retry: "shown" },
  summary: c => {
    const lines = c.repos.split("\n").filter(s => s.trim());
    return lines.length ? `${lines.length} repo${lines.length === 1 ? "" : "s"}` : "(no repos)";
  },
  executor: { kind: "git-provider", method: "cloneRepos" },
};
