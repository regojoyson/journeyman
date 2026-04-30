import { createLogger } from "@journeyman/core";
import type { INotificationProvider, IPhaseHandler, PhaseContext, PhaseInput, PhaseRunResult, ProviderResolver } from "@journeyman/core";

const log = createLogger("worker:notify");

export class SendMessagePhaseHandler implements IPhaseHandler {
  readonly phaseType = "send-message";
  constructor(private deps: { notification: ProviderResolver<INotificationProvider> }) {}

  async run(input: PhaseInput, ctx: PhaseContext): Promise<PhaseRunResult> {
    const channel = typeof input.channel === "string" ? input.channel : undefined;
    const message = typeof input.message === "string" ? input.message : undefined;
    if (!channel || !message) {
      return { kind: "failure", failure: { errorClass: "InvalidInput", message: "notify requires `channel` and `message`", retryable: false } };
    }
    const title = typeof input.title === "string" ? input.title : undefined;
    const notification = this.deps.notification.resolve(
      typeof input.provider === "string" ? input.provider : undefined,
    );
    ctx.log(`Notify ${channel}`);
    const result = await notification.send({ channel, message, title, sessionId: ctx.runId });
    if (result?.error || !result?.success) {
      log.error({ result }, "notify failed");
      return { kind: "failure", failure: { errorClass: "NotifyFailed", message: String(result?.error ?? "send returned success=false"), retryable: true } };
    }
    return { kind: "success", output: { messageId: result.messageId } };
  }
}
