// packages/phases/src/tickets/update-status.tsx
import { z } from "zod";
import type { PhaseDefinition } from "@journeyman/flow-editor";
import {
  UPDATE_STATUS_PHASE_TYPE,
  UPDATE_STATUS_LABEL,
  UPDATE_STATUS_CATEGORY,
  updateStatusOutputSchema,
} from "./update-status.meta.ts";

interface UpdateStatusConfig {
  ticketKey: string;
  status: string;
}

export const updateStatusPhase: PhaseDefinition<UpdateStatusConfig> = {
  phaseType: UPDATE_STATUS_PHASE_TYPE,
  label: UPDATE_STATUS_LABEL,
  category: UPDATE_STATUS_CATEGORY,
  description: "Transition a ticket to a new workflow status.",
  color: "#a29bfe",
  icon: "🚦",
  defaultConfig: { ticketKey: "", status: "" },
  configSchema: z.object({
    ticketKey: z.string().min(1),
    status: z.string().min(1),
  }),
  configFields: {
    ticketKey: { label: "Ticket key", widget: "text", help: "Supports #{ticket} placeholder" },
    status:    { label: "Target status", widget: "text", help: "e.g. development-started, code-review, completed" },
  },
  tabs: { io: "shown", credentials: "required", mcp: "hidden", retry: "shown" },
  summary: c => c.status || "(no status)",
  executor: { kind: "ticket-provider", method: "updateStatus" },
  outputSchema: updateStatusOutputSchema,
};
