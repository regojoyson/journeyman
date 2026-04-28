// packages/phases/src/repos/create-workspace.tsx
import { z } from "zod";
import type { PhaseDefinition } from "@journeyman/flow-editor";

interface CreateWorkspaceConfig {
  name: string;
  baseDir: string;
}

export const createWorkspacePhase: PhaseDefinition<CreateWorkspaceConfig> = {
  phaseType: "create-workspace",
  label: "Create Workspace",
  category: "Repos",
  description: "Create a new workspace directory for repo operations.",
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
};
