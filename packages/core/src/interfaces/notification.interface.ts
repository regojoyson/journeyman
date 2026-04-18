import type { SendNotificationOptions, SendNotificationResult } from "../types/notification.types.ts";

/**
 * Interface for notification operations.
 * Implement this to add support for Slack, Teams, email, etc.
 */
export interface INotificationProvider {
  send(opts: SendNotificationOptions): Promise<SendNotificationResult>;
}
