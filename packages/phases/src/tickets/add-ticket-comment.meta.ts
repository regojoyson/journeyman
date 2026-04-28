import type { OutputSchema } from "@journeyman/core";
import type { InputFields } from "../shared-meta.ts";

export const ADD_TICKET_COMMENT_PHASE_TYPE = "add-ticket-comment";
export const ADD_TICKET_COMMENT_LABEL = "Add Ticket Comment";
export const ADD_TICKET_COMMENT_CATEGORY = "Tickets";
export const addTicketCommentOutputSchema: OutputSchema = {
  commentId: { type: "string" },
};

export const addTicketCommentInputFields: InputFields = {
  ticketKey: { type: "string", label: "Ticket key", required: true },
  template:  { type: "string", label: "Template" },
  body:      { type: "string", label: "Body" },
};
