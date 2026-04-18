export type SendNotificationOptions = {
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

export type SendNotificationResult = {
  success: boolean;
  messageId?: string;
  error?: string;
};
