/**
 * @file ConsoleProvider — logs notifications via the shared Pino logger (dev/test use)
 */

import type { INotificationProvider, IProviderMeta } from "@journeyman/core";
import type { SendNotificationOptions, SendNotificationResult } from "@journeyman/core";
import { createLogger } from "@journeyman/core";

const log = createLogger("provider:console");

export class ConsoleProvider implements INotificationProvider {
  static meta: IProviderMeta = {
    id: "console",
    name: "Console",
    description: "Logs notifications to the application logger (dev/test use)",
    category: "notification",
  };

  async send(opts: SendNotificationOptions): Promise<SendNotificationResult> {
    log.info(
      { channel: opts.channel, title: opts.title, message: opts.message, sessionId: opts.sessionId },
      "notify",
    );
    return { success: true, messageId: Date.now().toString(), sessionId: opts.sessionId };
  }
}
