// packages/phases/src/tickets/update-status.tsx
import { z } from "zod";
import type { PhaseDefinition } from "@journeyman/flow-editor";

interface UpdateStatusConfig {
  ticketKey: string;
  status: string;
}

export const updateStatusPhase: PhaseDefinition<UpdateStatusConfig> = {
  phaseType: "update-status",
  label: "Update Status",
  category: "Tickets",
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
};
