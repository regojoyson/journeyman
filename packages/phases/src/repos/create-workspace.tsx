// packages/phases/src/repos/create-workspace.tsx
import { z } from "zod";
import type { PhaseDefinition } from "@journeyman/flow-editor";
import {
  CREATE_WORKSPACE_PHASE_TYPE,
  CREATE_WORKSPACE_LABEL,
  CREATE_WORKSPACE_CATEGORY,
  CREATE_WORKSPACE_DESCRIPTION,
  createWorkspaceOutputSchema,
} from "./create-workspace.meta.ts";

interface CreateWorkspaceConfig {
  name: string;
  baseDir: string;
}

export const createWorkspacePhase: PhaseDefinition<CreateWorkspaceConfig> = {
  phaseType: CREATE_WORKSPACE_PHASE_TYPE,
  label: CREATE_WORKSPACE_LABEL,
  category: CREATE_WORKSPACE_CATEGORY,
  description: CREATE_WORKSPACE_DESCRIPTION,
  color: "#fdcb6e",
  icon: "📁",
  defaultConfig: { name: "", baseDir: "" },
  configSchema: z.object({
    name: z.string().min(1),
    baseDir: z.string().min(1),
  }),
  configFields: {
    name:    { label: "Workspace name", widget: "text" },
    baseDir: { label: "Base directory", widget: "text" },
  },
  tabs: { io: "shown", credentials: "hidden", mcp: "hidden", retry: "shown" },
  summary: c => c.name || c.baseDir,
  executor: { kind: "coding-cli", method: "createWorkspace" },
  outputSchema: createWorkspaceOutputSchema,
};
