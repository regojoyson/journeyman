import type { OutputSchema } from "@journeyman/core";
import type { InputFields } from "../shared-meta.ts";

export const UPDATE_STATUS_PHASE_TYPE = "update-status";
export const UPDATE_STATUS_LABEL = "Update Status";
export const UPDATE_STATUS_CATEGORY = "Tickets";
export const updateStatusOutputSchema: OutputSchema = {
  status: { type: "string" },
};

export const updateStatusInputFields: InputFields = {
  ticketKey: { type: "string", label: "Ticket key", required: true },
  status:    { type: "string", label: "Status", required: true },
};
