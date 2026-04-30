import type { OutputSchema } from "@journeyman/core";
import type { InputFields } from "../shared-meta.ts";

export const SEND_MESSAGE_PHASE_TYPE = "send-message";
export const SEND_MESSAGE_LABEL = "Send Message";
export const SEND_MESSAGE_CATEGORY = "Messaging";
export const SEND_MESSAGE_DESCRIPTION =
  "Send a message via the configured messaging provider (Slack, etc.).";

export const sendMessageOutputSchema: OutputSchema = {
  delivered: { type: "boolean" },
  channelId: { type: "string" },
};

export const sendMessageInputFields: InputFields = {
  channel: { type: "string", label: "Channel / target", required: true },
  message: { type: "string", label: "Message", required: true },
  blocks:  { type: "json",   label: "Rich blocks (optional)" },
};
