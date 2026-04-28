// packages/phases/src/tickets/add-ticket-comment.tsx
import { z } from "zod";
import type { PhaseDefinition } from "@journeyman/flow-editor";
import {
  ADD_TICKET_COMMENT_PHASE_TYPE,
  ADD_TICKET_COMMENT_LABEL,
  ADD_TICKET_COMMENT_CATEGORY,
  addTicketCommentOutputSchema,
} from "./add-ticket-comment.meta.ts";

interface AddTicketCommentConfig {
  ticketKey: string;
  template: string;
  body?: string;
}

export const addTicketCommentPhase: PhaseDefinition<AddTicketCommentConfig> = {
  phaseType: ADD_TICKET_COMMENT_PHASE_TYPE,
  label: ADD_TICKET_COMMENT_LABEL,
  category: ADD_TICKET_COMMENT_CATEGORY,
  description: "Post a comment on a ticket, optionally rendered from a template.",
  color: "#a29bfe",
  icon: "💭",
  defaultConfig: { ticketKey: "", template: "", body: "" },
  configSchema: z.object({
    ticketKey: z.string().min(1),
    template: z.string(),
    body: z.string().optional(),
  }),
  configFields: {
    ticketKey: { label: "Ticket key", widget: "text", help: "Supports #{ticket} placeholder" },
    template:  { label: "Template id", widget: "text", help: "e.g. analysis-summary, completion-summary" },
    body:      { label: "Inline body (optional)", widget: "textarea", help: "Used when no template is set" },
  },
  tabs: { io: "shown", credentials: "required", mcp: "hidden", retry: "shown" },
  summary: c => c.template || c.ticketKey || "(no target)",
  executor: { kind: "ticket-provider", method: "addComment" },
  outputSchema: addTicketCommentOutputSchema,
};
