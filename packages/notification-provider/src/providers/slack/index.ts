import type { INotificationProvider, IProviderMeta } from "@journeyman/core";
import type { SendNotificationOptions, SendNotificationResult } from "@journeyman/core";

export type SlackProviderOptions =
  | { method: "token"; token: string }
  | { method: "webhook"; webhookUrl: string };

/** Slack notification provider. `token` → chat.postMessage; `webhook` → incoming webhook URL. */
export class SlackProvider implements INotificationProvider {
  static meta: IProviderMeta = {
    id: "slack",
    name: "Slack",
    description: "Slack notification provider",
    category: "notification",
  };

  constructor(private opts: SlackProviderOptions) {}

  async send(opts: SendNotificationOptions): Promise<SendNotificationResult> {
    const text = opts.title ? `*${opts.title}*\n${opts.message}` : opts.message;
    try {
      if (this.opts.method === "webhook") {
        const res = await fetch(this.opts.webhookUrl, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ text }),
        });
        if (!res.ok) {
          return { success: false, error: `Slack webhook failed: ${res.status}`, sessionId: opts.sessionId };
        }
        return { success: true, sessionId: opts.sessionId };
      }
      const res = await fetch("https://slack.com/api/chat.postMessage", {
        method: "POST",
        headers: { Authorization: `Bearer ${this.opts.token}`, "Content-Type": "application/json; charset=utf-8" },
        body: JSON.stringify({ channel: opts.channel, text }),
      });
      const data = (await res.json().catch(() => ({}))) as { ok?: boolean; ts?: string; error?: string };
      if (!data.ok) {
        return {
          success: false,
          error: `Slack chat.postMessage failed: ${data.error ?? res.status}`,
          sessionId: opts.sessionId,
        };
      }
      return { success: true, messageId: data.ts, sessionId: opts.sessionId };
    } catch (err: any) {
      return { success: false, error: `Slack send failed: ${err?.message ?? String(err)}`, sessionId: opts.sessionId };
    }
  }
}
