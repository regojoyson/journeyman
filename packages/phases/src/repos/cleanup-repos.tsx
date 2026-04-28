// packages/phases/src/repos/cleanup-repos.tsx
import { z } from "zod";
import type { PhaseDefinition } from "@journeyman/flow-editor";

interface CleanupReposConfig {
  workspaceDir: string;
  mode: "soft" | "hard";
}

export const cleanupReposPhase: PhaseDefinition<CleanupReposConfig> = {
  phaseType: "cleanup-repos",
  label: "Cleanup Repos",
  category: "Repos",
  description: "Reset and optionally delete repos in a workspace.",
  color: "#fdcb6e",
  icon: "🧹",
  defaultConfig: { workspaceDir: "", mode: "soft" },
  configSchema: z.object({
    workspaceDir: z.string().min(1),
    mode: z.enum(["soft", "hard"]),
  }),
  configFields: {
    workspaceDir: { label: "Workspace dir", widget: "text" },
    mode: {
      label: "Mode", widget: "select",
      options: [
        { value: "soft", label: "Soft (reset working tree)" },
        { value: "hard", label: "Hard (delete repos)" },
      ],
    },
  },
  tabs: { io: "shown", credentials: "hidden", mcp: "hidden", retry: "shown" },
  summary: c => `${c.mode}: ${c.workspaceDir}`,
  executor: { kind: "coding-cli", method: "cleanupRepos" },
};
