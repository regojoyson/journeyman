import { z } from "zod";
import type { PhaseDefinition } from "@journeyman/flow-editor";
import {
  CLEANUP_WORKSPACE_PHASE_TYPE,
  CLEANUP_WORKSPACE_LABEL,
  CLEANUP_WORKSPACE_CATEGORY,
  CLEANUP_WORKSPACE_DESCRIPTION,
  cleanupWorkspaceOutputSchema,
} from "./cleanup-workspace.meta.ts";

interface CleanupWorkspaceConfig {
  mode: "soft" | "hard";
}

export const cleanupWorkspacePhase: PhaseDefinition<CleanupWorkspaceConfig> = {
  phaseType: CLEANUP_WORKSPACE_PHASE_TYPE,
  label: CLEANUP_WORKSPACE_LABEL,
  category: CLEANUP_WORKSPACE_CATEGORY,
  description: CLEANUP_WORKSPACE_DESCRIPTION,
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
  tabs: { io: "shown", requiredSecrets: "hidden", mcp: "hidden", retry: "shown" },
  summary: c => c.mode,
  executor: { kind: "coding-cli", method: "cleanupRepos" },
  outputSchema: cleanupWorkspaceOutputSchema,
};
