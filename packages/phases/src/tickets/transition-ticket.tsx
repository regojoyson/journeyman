import { z } from "zod";
import type { PhaseDefinition } from "@journeyman/flow-editor";
import {
  TRANSITION_TICKET_PHASE_TYPE,
  TRANSITION_TICKET_LABEL,
  TRANSITION_TICKET_CATEGORY,
  TRANSITION_TICKET_DESCRIPTION,
  transitionTicketOutputSchema,
} from "./transition-ticket.meta.ts";

interface TransitionTicketConfig {
  ticketKey: string;
  status: string;
}

export const transitionTicketPhase: PhaseDefinition<TransitionTicketConfig> = {
  phaseType: TRANSITION_TICKET_PHASE_TYPE,
  label: TRANSITION_TICKET_LABEL,
  category: TRANSITION_TICKET_CATEGORY,
  description: TRANSITION_TICKET_DESCRIPTION,
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
  defaultRequiredSecrets: ["GITHUB_ACCESS_TOKEN"],
  summary: c => c.status || "(no status)",
  executor: { kind: "ticket-provider", method: "updateStatus" },
  outputSchema: transitionTicketOutputSchema,
};
