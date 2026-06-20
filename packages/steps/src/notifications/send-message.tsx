import type { StepDefinition } from "@journeyman/flow-editor";
import {
  SEND_MESSAGE_STEP_TYPE,
  SEND_MESSAGE_LABEL,
  SEND_MESSAGE_CATEGORY,
  SEND_MESSAGE_DESCRIPTION,
  sendMessageOutputSchema,
  sendMessageConfigSchema,
} from "./send-message.meta.ts";

interface SendMessageConfig {
  channel: string;
  title?: string;
  message: string;
  blocks?: string;
}

export const sendMessageStep: StepDefinition<SendMessageConfig> = {
  stepType: SEND_MESSAGE_STEP_TYPE,
  label: SEND_MESSAGE_LABEL,
  category: SEND_MESSAGE_CATEGORY,
  description: SEND_MESSAGE_DESCRIPTION,
  color: "#fd79a8",
  icon: "💬",
  defaultConfig: { channel: "", title: "", message: "", blocks: "" },
  configSchema: sendMessageConfigSchema,
  configFields: {
    channel: { label: "Channel / target", widget: "text", help: "e.g. #deploys (Slack)" },
    title:   { label: "Subject", widget: "text", help: "Subject line (used by email)" },
    message: { label: "Message", widget: "textarea", help: "Supports placeholders like #{issue}" },
    blocks:  { label: "Rich blocks (optional)", widget: "code", help: "Provider-specific rich formatting JSON" },
  },
  tabs: { io: "hidden", mcp: "hidden", retry: "shown", requiredSecrets: "hidden" },
  summary: c => c.channel || "(no channel)",
  executor: { kind: "notification", method: "send" },
  outputSchema: sendMessageOutputSchema,
  comingSoon: true,
};
