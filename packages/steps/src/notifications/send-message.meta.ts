import { z } from "zod";
import type { OutputSchema, InputFields } from "@journeyman/core";

export const sendMessageConfigSchema = z.object({
  channel: z.string().min(1),
  title: z.string().optional(),
  message: z.string().min(1),
  blocks: z.string().optional(),
});

export const SEND_MESSAGE_STEP_TYPE = "send-message";
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
  title:   { shape: { type: "string" }, label: "Subject" },
  message: { shape: { type: "string" }, label: "Message", required: true },
  blocks:  { shape: { type: "object", fields: {} }, label: "Rich blocks (optional)" },
};
