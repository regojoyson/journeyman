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
  ticketId: string;
}

export const createWorkspacePhase: PhaseDefinition<CreateWorkspaceConfig> = {
  phaseType: CREATE_WORKSPACE_PHASE_TYPE,
  label: CREATE_WORKSPACE_LABEL,
  category: CREATE_WORKSPACE_CATEGORY,
  description: CREATE_WORKSPACE_DESCRIPTION,
  color: "#fdcb6e",
  icon: "📁",
  defaultConfig: { ticketId: "" },
  configSchema: z.object({
    ticketId: z.string().min(1),
  }),
  configFields: {
    ticketId: { label: "Ticket ID", widget: "text" },
  },
  tabs: { io: "shown", requiredSecrets: "hidden", mcp: "hidden", retry: "shown" },
  summary: c => c.ticketId,
  executor: { kind: "coding-cli", method: "createWorkspace" },
  outputSchema: createWorkspaceOutputSchema,
};
