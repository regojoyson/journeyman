import type { OutputSchema } from "@journeyman/core";
import type { InputFields } from "../shared-meta.ts";

export const GET_TICKET_PHASE_TYPE = "get-ticket";
export const GET_TICKET_LABEL = "Get Ticket";
export const GET_TICKET_CATEGORY = "Issue Tracker";
export const GET_TICKET_DESCRIPTION =
  "Fetch a ticket from the configured tracker.";

export const getTicketOutputSchema: OutputSchema = {
  id: { type: "string" },
  title: { type: "string" },
  description: { type: "string" },
  labels: { type: "string[]" },
  status: { type: "string" },
};

export const getTicketInputFields: InputFields = {
  issueRef: { type: "string", label: "Issue ref", required: true },
};
