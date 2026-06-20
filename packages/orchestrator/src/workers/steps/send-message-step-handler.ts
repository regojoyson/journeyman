import { createLogger } from "@journeyman/core";
import type { INotificationProvider, IStepHandler, StepContext, StepInput, StepRunResult, ProviderFactory } from "@journeyman/core";

const log = createLogger("worker:notify");

export class SendMessageStepHandler implements IStepHandler {
  readonly stepType = "send-message";
  constructor(private deps: { notification: ProviderFactory<INotificationProvider> }) {}

  async run(input: StepInput, ctx: StepContext): Promise<StepRunResult> {
    const channel = typeof input.channel === "string" ? input.channel : undefined;
    const message = typeof input.message === "string" ? input.message : undefined;
    if (!channel || !message) {
      return { kind: "failure", failure: { errorClass: "InvalidInput", message: "notify requires `channel` and `message`", retryable: false } };
    }
    const title = typeof input.title === "string" ? input.title : undefined;
    const notification = this.deps.notification(ctx.connection?.provider, ctx.env, ctx.connection);
    ctx.log(`Notify ${channel}`);
    const result = await notification.send({ channel, message, title, sessionId: ctx.workflowInstanceId });
    if (result?.error || !result?.success) {
      log.error({ result }, "notify failed");
      return { kind: "failure", failure: { errorClass: "NotifyFailed", message: String(result?.error ?? "send returned success=false"), retryable: true } };
    }
    return { kind: "success", output: { messageId: result.messageId } };
  }
}
