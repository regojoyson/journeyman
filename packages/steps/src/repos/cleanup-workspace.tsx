import type { StepDefinition } from "@journeyman/flow-editor";
import {
  CLEANUP_WORKSPACE_STEP_TYPE,
  CLEANUP_WORKSPACE_LABEL,
  CLEANUP_WORKSPACE_CATEGORY,
  CLEANUP_WORKSPACE_DESCRIPTION,
  cleanupWorkspaceOutputSchema,
  cleanupWorkspaceConfigSchema,
} from "./cleanup-workspace.meta.ts";

interface CleanupWorkspaceConfig {
  mode: "soft" | "hard";
}

export const cleanupWorkspaceStep: StepDefinition<CleanupWorkspaceConfig> = {
  stepType: CLEANUP_WORKSPACE_STEP_TYPE,
  label: CLEANUP_WORKSPACE_LABEL,
  category: CLEANUP_WORKSPACE_CATEGORY,
  description: CLEANUP_WORKSPACE_DESCRIPTION,
  color: "#fdcb6e",
  icon: "🧹",
  defaultConfig: { mode: "soft" },
  configSchema: cleanupWorkspaceConfigSchema,
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
  comingSoon: true,
};
