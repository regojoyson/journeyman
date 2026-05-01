// packages/phases/src/tickets/get-ticket.tsx
import { z } from "zod";
import type { PhaseDefinition } from "@journeyman/flow-editor";
import { summaryValue } from "@journeyman/flow-editor";
import {
  GET_TICKET_PHASE_TYPE,
  GET_TICKET_LABEL,
  GET_TICKET_CATEGORY,
  GET_TICKET_DESCRIPTION,
  getTicketOutputSchema,
} from "./get-ticket.meta.ts";

interface GetTicketConfig {
  ticketKey: string;
}

export const getTicketPhase: PhaseDefinition<GetTicketConfig> = {
  phaseType: GET_TICKET_PHASE_TYPE,
  label: GET_TICKET_LABEL,
  category: GET_TICKET_CATEGORY,
  description: GET_TICKET_DESCRIPTION,
  color: "#a29bfe",
  icon: "📥",
  defaultConfig: { ticketKey: "" },
  configSchema: z.object({
    ticketKey: z.string().min(1),
  }),
  configFields: {
    ticketKey: { label: "Ticket key", widget: "text", help: "e.g. PROJ-123 (supports #{ticket} placeholder)" },
  },
  tabs: { io: "shown", mcp: "hidden", retry: "shown" },
  slots: [
    {
      name: "GITHUB_ACCESS_TOKEN",
      description: "GitHub PAT with repo and project scopes — used to call the GitHub API.",
    },
  ],
  summary: (c, ctx) => summaryValue(c, ctx, "ticketKey") || "(no ticket)",
  executor: { kind: "ticket-provider", method: "getTicket" },
  outputSchema: getTicketOutputSchema,
};
