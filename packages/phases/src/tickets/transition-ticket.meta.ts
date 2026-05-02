import type { OutputSchema } from "@journeyman/core";
import type { InputFields } from "../shared-meta.ts";

export const TRANSITION_TICKET_PHASE_TYPE = "transition-ticket";
export const TRANSITION_TICKET_LABEL = "Transition Ticket";
export const TRANSITION_TICKET_CATEGORY = "Issue Tracker";
export const TRANSITION_TICKET_DESCRIPTION =
  "Move a ticket to a new workflow status.";

export const transitionTicketOutputSchema: OutputSchema = {
  status: { type: "string" },
};

export const transitionTicketInputFields: InputFields = {
  issueRef: { type: "string", label: "Issue ref", required: true },
  status:    { type: "string", label: "Status", required: true },
};
