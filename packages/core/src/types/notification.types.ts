import type { SessionOptions, SessionResult } from "./session.types.ts";

export type SendNotificationOptions = SessionOptions & {
  channel: string;
  message: string;
  title?: string;
  attachments?: NotificationAttachment[];
};

export type NotificationAttachment = {
  title?: string;
  text?: string;
  color?: string;
  fields?: { label: string; value: string }[];
};

export type SendNotificationResult = SessionResult & {
  success: boolean;
  messageId?: string;
  error?: string;
};
