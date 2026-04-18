import type { INotificationProvider } from "@journeyman/core";
import type { SendNotificationOptions, SendNotificationResult } from "@journeyman/core";

/** Slack notification provider. Not yet implemented. */
export class SlackProvider implements INotificationProvider {
  send(_opts: SendNotificationOptions): Promise<SendNotificationResult> {
    throw new Error("SlackProvider.send not implemented");
  }
}
