import type { OutputSchema } from "@journeyman/core";
import type { InputFields } from "../shared-meta.ts";

export const NOTIFY_PHASE_TYPE = "notify";
export const NOTIFY_LABEL = "Notify";
export const NOTIFY_CATEGORY = "Notifications";

export const notifyOutputSchema: OutputSchema = {
  delivered: { type: "boolean" },
  channelId: { type: "string" },
};

export const notifyInputFields: InputFields = {
  channel: { type: "string", label: "Channel / target", required: true },
  message: { type: "string", label: "Message", required: true },
  blocks:  { type: "json",   label: "Rich blocks (optional)" },
};
