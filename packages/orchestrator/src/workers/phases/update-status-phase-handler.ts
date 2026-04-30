import { createLogger } from "@journeyman/core";
import type {
  ITicketProvider, IPhaseHandler, PhaseContext, PhaseInput, PhaseRunResult,
  ProviderResolver,
} from "@journeyman/core";

const log = createLogger("worker:update-status");

/**
 * Wraps ITicketProvider.updateStatus.
 *
 * Inputs:
 *   - ticketKey | id — issue identifier (string, required)
 *   - status         — new status (string, required)
 *
 * Returns the updated ticket fields.
 */
export class UpdateStatusPhaseHandler implements IPhaseHandler {
  readonly phaseType = "update-status";

  constructor(private deps: { ticket: ProviderResolver<ITicketProvider> }) {}

  async run(input: PhaseInput, ctx: PhaseContext): Promise<PhaseRunResult> {
    const id = typeof input.id === "string" ? input.id
      : typeof input.ticketKey === "string" ? input.ticketKey : undefined;
    const status = typeof input.status === "string" ? input.status : undefined;
    if (!id || !status) {
      return {
        kind: "failure",
        failure: {
          errorClass: "InvalidInput",
          message: "update-status requires `ticketKey`/`id` and `status`",
          retryable: false,
        },
      };
    }
    const ticket = this.deps.ticket.resolve(
      typeof input.provider === "string" ? input.provider : undefined,
    );
    ctx.log(`Updating ticket ${id} → ${status}`);
    const result = await ticket.updateStatus({ id, status, sessionId: ctx.runId });
    if (result?.error) {
      log.error({ result }, "update-status failed");
      return {
        kind: "failure",
        failure: { errorClass: "UpdateStatusFailed", message: String(result.error), retryable: true },
      };
    }
    return {
      kind: "success",
      output: {
        id: result.ticket?.id ?? id,
        status: result.ticket?.status ?? status,
      },
    };
  }
}
