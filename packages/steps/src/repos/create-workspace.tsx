import type { StepDefinition } from "@journeyman/flow-editor";
import {
  CREATE_WORKSPACE_STEP_TYPE,
  CREATE_WORKSPACE_LABEL,
  CREATE_WORKSPACE_CATEGORY,
  CREATE_WORKSPACE_DESCRIPTION,
  createWorkspaceOutputSchema,
  createWorkspaceConfigSchema,
} from "./create-workspace.meta.ts";

interface CreateWorkspaceConfig {
  issueRef: string;
}

export const createWorkspaceStep: StepDefinition<CreateWorkspaceConfig> = {
  stepType: CREATE_WORKSPACE_STEP_TYPE,
  label: CREATE_WORKSPACE_LABEL,
  category: CREATE_WORKSPACE_CATEGORY,
  description: CREATE_WORKSPACE_DESCRIPTION,
  color: "#fdcb6e",
  icon: "📁",
  defaultConfig: { issueRef: "" },
  configSchema: createWorkspaceConfigSchema,
  configFields: {
    issueRef: { label: "Issue ref", widget: "text" },
  },
  tabs: { io: "shown", requiredSecrets: "hidden", mcp: "hidden", retry: "shown" },
  summary: c => c.issueRef,
  executor: { kind: "coding-cli", method: "createWorkspace" },
  outputSchema: createWorkspaceOutputSchema,
};
