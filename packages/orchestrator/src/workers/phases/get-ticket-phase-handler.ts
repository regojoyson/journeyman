import { createLogger } from "@journeyman/core";
import type {
  ITicketProvider, IPhaseHandler, PhaseContext, PhaseInput, PhaseRunResult,
  ProviderResolver,
} from "@journeyman/core";

const log = createLogger("worker:get-ticket");

/**
 * Wraps ITicketProvider.getTicket.
 *
 * Inputs (any of):
 *   - ticketKey  — issue key (e.g. "PROJ-123")
 *   - id         — provider id (string)
 *
 * Returns the ticket fields flattened into output (id, title, description, status, labels[]).
 */
export class GetTicketPhaseHandler implements IPhaseHandler {
  readonly phaseType = "get-ticket";

  constructor(private deps: { ticket: ProviderResolver<ITicketProvider> }) {}

  async run(input: PhaseInput, ctx: PhaseContext): Promise<PhaseRunResult> {
    const id = typeof input.id === "string" ? input.id
      : typeof input.ticketKey === "string" ? input.ticketKey : undefined;
    if (!id) {
      return {
        kind: "failure",
        failure: {
          errorClass: "InvalidInput",
          message: "get-ticket requires `ticketKey` or `id`",
          retryable: false,
        },
      };
    }
    const ticket = this.deps.ticket.resolve(
      typeof input.provider === "string" ? input.provider : undefined,
    );
    ctx.log(`Fetching ticket ${id}`);
    const result = await ticket.getTicket({ id, sessionId: ctx.runId });
    if (result?.error || !result?.ticket) {
      log.error({ result }, "get-ticket failed");
      return {
        kind: "failure",
        failure: { errorClass: "GetTicketFailed", message: String(result?.error ?? "no ticket returned"), retryable: true },
      };
    }
    const t = result.ticket;
    return {
      kind: "success",
      output: {
        id: t.id,
        title: t.title,
        description: t.description ?? "",
        status: t.status ?? "",
        labels: t.labels ?? [],
        url: t.url,
      },
    };
  }
}
