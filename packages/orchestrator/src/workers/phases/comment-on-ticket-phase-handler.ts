import { createLogger } from "@journeyman/core";
import type { ITicketProvider, IPhaseHandler, PhaseContext, PhaseInput, PhaseRunResult, ProviderFactory } from "@journeyman/core";

const log = createLogger("worker:add-ticket-comment");

export class CommentOnTicketPhaseHandler implements IPhaseHandler {
  readonly phaseType = "comment-on-ticket";
  constructor(private deps: { ticket: ProviderFactory<ITicketProvider> }) {}

  async run(input: PhaseInput, ctx: PhaseContext): Promise<PhaseRunResult> {
    const id = typeof input.id === "string" ? input.id
      : typeof input.ticketKey === "string" ? input.ticketKey : undefined;
    const body = typeof input.body === "string" ? input.body : undefined;
    if (!id || !body) {
      return { kind: "failure", failure: { errorClass: "InvalidInput", message: "add-ticket-comment requires `id`/`ticketKey` and `body`", retryable: false } };
    }
    const ticket = this.deps.ticket(typeof input.provider === "string" ? input.provider : undefined, ctx.env);
    ctx.log(`Add comment to ticket ${id}`);
    const result = await ticket.addComment({ id, body, sessionId: ctx.runId });
    if (result?.error) {
      log.error({ result }, "add-ticket-comment failed");
      return { kind: "failure", failure: { errorClass: "AddTicketCommentFailed", message: String(result.error), retryable: true } };
    }
    return { kind: "success", output: { commentId: result.comment?.id } };
  }
}
