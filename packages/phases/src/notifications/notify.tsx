// packages/phases/src/notifications/notify.tsx
import { z } from "zod";
import type { PhaseDefinition } from "@journeyman/flow-editor";

interface NotifyConfig {
  channel: string;
  message: string;
  blocks?: string;
}

export const notifyPhase: PhaseDefinition<NotifyConfig> = {
  phaseType: "notify",
  label: "Notify",
  category: "Notifications",
  description: "Send a notification via the configured provider (Slack, etc).",
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
    message: { label: "Message", widget: "textarea", help: "Supports placeholders like #{ticket}" },
    blocks:  { label: "Rich blocks (optional)", widget: "code", help: "Provider-specific rich formatting JSON" },
  },
  tabs: { io: "hidden", credentials: "required", mcp: "hidden", retry: "shown" },
  summary: c => c.channel || "(no channel)",
  executor: { kind: "notification", method: "send" },
};
