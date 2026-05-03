import type { OutputSchema, InputFields } from "@journeyman/core";

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
  channel: { shape: { type: "string" }, label: "Channel / target", required: true },
  message: { shape: { type: "string" }, label: "Message", required: true },
  blocks:  { shape: { type: "object", fields: {} }, label: "Rich blocks (optional)" },
};
