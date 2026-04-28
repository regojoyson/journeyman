import type { OutputSchema } from "@journeyman/core";
import type { InputFields } from "../shared-meta.ts";

export const UPDATE_TICKET_PHASE_TYPE = "update-ticket";
export const UPDATE_TICKET_LABEL = "Update Ticket";
export const UPDATE_TICKET_CATEGORY = "Tickets";
export const updateTicketOutputSchema: OutputSchema = {
  updated: { type: "boolean" },
};

export const updateTicketInputFields: InputFields = {
  ticketKey: { type: "string", label: "Ticket key", required: true },
  fields:    { type: "json",   label: "Fields" },
};
