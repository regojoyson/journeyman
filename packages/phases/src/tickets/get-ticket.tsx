// packages/phases/src/tickets/get-ticket.tsx
import { z } from "zod";
import type { PhaseDefinition } from "@journeyman/flow-editor";

interface GetTicketConfig {
  ticketKey: string;
}

export const getTicketPhase: PhaseDefinition<GetTicketConfig> = {
  phaseType: "get-ticket",
  label: "Get Ticket",
  category: "Tickets",
  description: "Fetch a ticket from the configured tracker.",
  color: "#a29bfe",
  icon: "📥",
  defaultConfig: { ticketKey: "" },
  configSchema: z.object({
    ticketKey: z.string().min(1),
  }),
  configFields: {
    ticketKey: { label: "Ticket key", widget: "text", help: "e.g. PROJ-123 (supports #{ticket} placeholder)" },
  },
  tabs: { io: "shown", credentials: "required", mcp: "hidden", retry: "shown" },
  summary: c => c.ticketKey || "(no ticket)",
  executor: { kind: "ticket-provider", method: "getTicket" },
};
