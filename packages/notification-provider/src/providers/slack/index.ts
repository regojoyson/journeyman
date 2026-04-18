import type { INotificationProvider, IProviderMeta } from "@journeyman/core";
import type { SendNotificationOptions, SendNotificationResult } from "@journeyman/core";

/** Slack notification provider. Not yet implemented. */
export class SlackProvider implements INotificationProvider {
  static meta: IProviderMeta = {
    id: "slack",
    name: "Slack",
    description: "Slack notification provider",
    category: "notification",
  };

  send(_opts: SendNotificationOptions): Promise<SendNotificationResult> {
    throw new Error("SlackProvider.send not implemented");
  }
}
