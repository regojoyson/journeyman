/**
 * The input boxes an editor should show for a notification provider. All
 * fields persist into the same three backend slots on SendNotificationOptions
 * (`channel`, `title`, `message`); only the visible labels/help/order differ.
 * Single source of truth shared by the flow-editor step config and the agent
 * notifications section.
 */
export interface NotificationField {
  key: "channel" | "title" | "message";
  label: string;
  help?: string;
  placeholder?: string;
  required?: boolean;
}

export function notificationFields(provider?: string): NotificationField[] {
  switch (provider) {
    case "email":
      return [
        { key: "channel", label: "Recipient email", help: "Address the notification is sent to.", placeholder: "alice@acme.com", required: true },
        { key: "title", label: "Subject", help: "Email subject line.", placeholder: "Run finished" },
        { key: "message", label: "Email body", help: "Plain-text body of the email.", required: true },
      ];
    case "slack":
      return [
        { key: "channel", label: "Channel / user", help: "Channel (#alerts) or user ID. Ignored for incoming webhooks.", placeholder: "#alerts or U01234", required: true },
        { key: "title", label: "Subject (optional)", help: "Shown as a bold first line above the message.", placeholder: "Deployment update" },
        { key: "message", label: "Message", help: "Message text to post.", required: true },
      ];
    default:
      return [
        { key: "channel", label: "Channel / recipient", help: "Where to deliver the notification.", required: true },
        { key: "message", label: "Message", help: "Message text.", required: true },
      ];
  }
}
