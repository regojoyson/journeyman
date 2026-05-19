import type { PhaseDefinition } from "@journeyman/flow-editor";
import {
  LIST_WORKSPACE_FILES_PHASE_TYPE,
  LIST_WORKSPACE_FILES_LABEL,
  LIST_WORKSPACE_FILES_CATEGORY,
  LIST_WORKSPACE_FILES_DESCRIPTION,
  listWorkspaceFilesOutputSchema,
  listWorkspaceFilesConfigSchema,
} from "./list-workspace-files.meta.ts";

interface ListWorkspaceFilesConfig {
  pattern: string;
}

export const listWorkspaceFilesPhase: PhaseDefinition<ListWorkspaceFilesConfig> = {
  phaseType: LIST_WORKSPACE_FILES_PHASE_TYPE,
  label: LIST_WORKSPACE_FILES_LABEL,
  category: LIST_WORKSPACE_FILES_CATEGORY,
  description: LIST_WORKSPACE_FILES_DESCRIPTION,
  color: "#fdcb6e",
  icon: "🔍",
  defaultConfig: { pattern: "*" },
  configSchema: listWorkspaceFilesConfigSchema,
  configFields: {
    pattern:      { label: "Glob pattern",  widget: "text", help: "e.g. */api-*" },
  },
  tabs: { io: "shown", requiredSecrets: "hidden", mcp: "hidden", retry: "shown" },
  summary: c => c.pattern,
  executor: { kind: "coding-cli", method: "scanRepos" },
  outputSchema: listWorkspaceFilesOutputSchema,
  comingSoon: true,
};
