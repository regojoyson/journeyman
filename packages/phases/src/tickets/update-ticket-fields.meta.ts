import type { OutputSchema } from "@journeyman/core";
import type { InputFields } from "../shared-meta.ts";

export const UPDATE_TICKET_FIELDS_PHASE_TYPE = "update-ticket-fields";
export const UPDATE_TICKET_FIELDS_LABEL = "Update Ticket Fields";
export const UPDATE_TICKET_FIELDS_CATEGORY = "Issue Tracker";
export const UPDATE_TICKET_FIELDS_DESCRIPTION =
  "Update arbitrary fields on an existing ticket.";

export const updateTicketFieldsOutputSchema: OutputSchema = {
  updated: { type: "boolean" },
};

export const updateTicketFieldsInputFields: InputFields = {
  issueRef: { type: "string", label: "Issue ref", required: true },
  fields:    { type: "json",   label: "Fields" },
};
