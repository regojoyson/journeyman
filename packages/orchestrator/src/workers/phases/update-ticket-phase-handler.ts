import { createLogger } from "@journeyman/core";
import type { ITicketProvider, IPhaseHandler, PhaseContext, PhaseInput, PhaseRunResult, ProviderResolver } from "@journeyman/core";

const log = createLogger("worker:update-ticket");

export class UpdateTicketPhaseHandler implements IPhaseHandler {
  readonly phaseType = "update-ticket";
  constructor(private deps: { ticket: ProviderResolver<ITicketProvider> }) {}

  async run(input: PhaseInput, ctx: PhaseContext): Promise<PhaseRunResult> {
    const id = typeof input.id === "string" ? input.id
      : typeof input.ticketKey === "string" ? input.ticketKey : undefined;
    if (!id) {
      return { kind: "failure", failure: { errorClass: "InvalidInput", message: "update-ticket requires `id`/`ticketKey`", retryable: false } };
    }
    const title = typeof input.title === "string" ? input.title : undefined;
    const description = typeof input.description === "string" ? input.description : undefined;
    const status = typeof input.status === "string" ? input.status : undefined;
    const assignee = typeof input.assignee === "string" ? input.assignee : undefined;
    const labels = Array.isArray(input.labels) && input.labels.every((l) => typeof l === "string") ? (input.labels as string[]) : undefined;
    const ticket = this.deps.ticket.resolve(
      typeof input.provider === "string" ? input.provider : undefined,
    );
    ctx.log(`Update ticket ${id}`);
    const result = await ticket.updateTicket({ id, title, description, status, assignee, labels, sessionId: ctx.runId });
    if (result?.error) {
      log.error({ result }, "update-ticket failed");
      return { kind: "failure", failure: { errorClass: "UpdateTicketFailed", message: String(result.error), retryable: true } };
    }
    return { kind: "success", output: { id: result.ticket?.id ?? id, status: result.ticket?.status } };
  }
}
