// packages/phases/src/notifications/notify.tsx
import { z } from "zod";
import type { PhaseDefinition } from "@journeyman/flow-editor";
import {
  NOTIFY_PHASE_TYPE,
  NOTIFY_LABEL,
  NOTIFY_CATEGORY,
  notifyOutputSchema,
} from "./notify.meta.ts";

interface NotifyConfig {
  channel: string;
  message: string;
  blocks?: string;
}

export const notifyPhase: PhaseDefinition<NotifyConfig> = {
  phaseType: NOTIFY_PHASE_TYPE,
  label: NOTIFY_LABEL,
  category: NOTIFY_CATEGORY,
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
  outputSchema: notifyOutputSchema,
};
