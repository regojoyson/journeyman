// packages/phases/src/repos/cleanup-repos.tsx
import { z } from "zod";
import type { PhaseDefinition } from "@journeyman/flow-editor";
import {
  CLEANUP_REPOS_PHASE_TYPE,
  CLEANUP_REPOS_LABEL,
  CLEANUP_REPOS_CATEGORY,
  cleanupReposOutputSchema,
} from "./cleanup-repos.meta.ts";

interface CleanupReposConfig {
  mode: "soft" | "hard";
}

export const cleanupReposPhase: PhaseDefinition<CleanupReposConfig> = {
  phaseType: CLEANUP_REPOS_PHASE_TYPE,
  label: CLEANUP_REPOS_LABEL,
  category: CLEANUP_REPOS_CATEGORY,
  description: "Reset and optionally delete repos in a workspace.",
  color: "#fdcb6e",
  icon: "🧹",
  defaultConfig: { mode: "soft" },
  configSchema: z.object({
    mode: z.enum(["soft", "hard"]),
  }),
  configFields: {
    mode: {
      label: "Mode", widget: "select",
      options: [
        { value: "soft", label: "Soft (reset working tree)" },
        { value: "hard", label: "Hard (delete repos)" },
      ],
    },
  },
  tabs: { io: "shown", credentials: "hidden", mcp: "hidden", retry: "shown" },
  summary: c => c.mode,
  executor: { kind: "coding-cli", method: "cleanupRepos" },
  outputSchema: cleanupReposOutputSchema,
};
