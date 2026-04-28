import type { OutputSchema } from "@journeyman/core";
import type { InputFields } from "../shared-meta.ts";

export const CREATE_TICKET_PHASE_TYPE = "create-ticket";
export const CREATE_TICKET_LABEL = "Create Ticket";
export const CREATE_TICKET_CATEGORY = "Tickets";
export const createTicketOutputSchema: OutputSchema = {
  id: { type: "string" },
  url: { type: "string" },
};

export const createTicketInputFields: InputFields = {
  project:     { type: "string", label: "Project", required: true },
  title:       { type: "string", label: "Title", required: true },
  description: { type: "string", label: "Description" },
};
