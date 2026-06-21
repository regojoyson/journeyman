import { createLogger } from "@journeyman/core";
import type { INotificationProvider, IStepHandler, StepContext, StepInput, StepRunResult, ProviderFactory } from "@journeyman/core";

const log = createLogger("worker:notify");

export class SendMessageStepHandler implements IStepHandler {
  readonly stepType = "send-message";
  constructor(private deps: { notification: ProviderFactory<INotificationProvider> }) {}

  async run(input: StepInput, ctx: StepContext): Promise<StepRunResult> {
    const required = input.required === true;
    const channel = typeof input.channel === "string" ? input.channel : undefined;
    const message = typeof input.message === "string" ? input.message : undefined;
    const title = typeof input.title === "string" ? input.title : undefined;

    // When `required` is off (default), a failed or unconfigured notification is
    // logged and ignored — the step still succeeds (delivered: false). When on,
    // the same conditions fail the step (NotifyFailed is retryable).
    const softFail = (errorClass: string, msg: string): StepRunResult => {
      if (required) {
        log.error({ errorClass, msg }, "notify failed (required)");
        return { kind: "failure", failure: { errorClass, message: msg, retryable: errorClass === "NotifyFailed" } };
      }
      log.warn({ errorClass, msg }, "notify failed (optional) — ignored");
      ctx.log(`Notify skipped: ${msg}`);
      return { kind: "success", output: { delivered: false, error: msg } };
    };

    if (!channel || !message) {
      return softFail("InvalidInput", "notify requires `channel` and `message`");
    }
    if (!ctx.connection) {
      return softFail("NoConnection", "no notification connection configured");
    }

    ctx.log(`Notify ${channel}`);
    try {
      // Construct inside the try: an unknown/legacy provider makes
      // buildNotificationProvider throw, which must be soft-failable too.
      const notification = this.deps.notification(ctx.connection.provider, ctx.env, ctx.connection);
      const result = await notification.send({ channel, message, title, sessionId: ctx.workflowInstanceId });
      if (result?.error || !result?.success) {
        return softFail("NotifyFailed", String(result?.error ?? "send returned success=false"));
      }
      return { kind: "success", output: { delivered: true, messageId: result.messageId } };
    } catch (err: any) {
      return softFail("NotifyFailed", err?.message ?? String(err));
    }
  }
}
