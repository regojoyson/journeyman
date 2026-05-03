import { z } from "zod";
import type { PhaseDefinition } from "@journeyman/flow-editor";
import {
  SEND_MESSAGE_PHASE_TYPE,
  SEND_MESSAGE_LABEL,
  SEND_MESSAGE_CATEGORY,
  SEND_MESSAGE_DESCRIPTION,
  sendMessageOutputSchema,
} from "./send-message.meta.ts";

interface SendMessageConfig {
  channel: string;
  message: string;
  blocks?: string;
}

export const sendMessagePhase: PhaseDefinition<SendMessageConfig> = {
  phaseType: SEND_MESSAGE_PHASE_TYPE,
  label: SEND_MESSAGE_LABEL,
  category: SEND_MESSAGE_CATEGORY,
  description: SEND_MESSAGE_DESCRIPTION,
  color: "#fd79a8",
  icon: "💬",
  defaultConfig: { channel: "", message: "", blocks: "" },
  configSchema: z.object({
    channel: z.string().min(1),
    message: z.string().min(1),
    blocks: z.string().optional(),
  }),
  configFields: {
    channel: { label: "Channel / target", widget: "text", help: "e.g. #deploys (Slack)" },
    message: { label: "Message", widget: "textarea", help: "Supports placeholders like #{issue}" },
    blocks:  { label: "Rich blocks (optional)", widget: "code", help: "Provider-specific rich formatting JSON" },
  },
  tabs: { io: "hidden", mcp: "hidden", retry: "shown" },
  slots: [
    {
      name: "SLACK_BOT_TOKEN",
      description: "Slack bot token (xoxb-...) used to post messages.",
    },
  ],
  summary: c => c.channel || "(no channel)",
  executor: { kind: "notification", method: "send" },
  outputSchema: sendMessageOutputSchema,
};
