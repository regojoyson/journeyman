import { createLogger } from "@journeyman/core";
import type { ITicketProvider, IPhaseHandler, PhaseContext, PhaseInput, PhaseRunResult, ProviderResolver } from "@journeyman/core";

const log = createLogger("worker:create-ticket");

export class CreateTicketPhaseHandler implements IPhaseHandler {
  readonly phaseType = "create-ticket";
  constructor(private deps: { ticket: ProviderResolver<ITicketProvider> }) {}

  async run(input: PhaseInput, ctx: PhaseContext): Promise<PhaseRunResult> {
    const title = typeof input.title === "string" ? input.title : undefined;
    if (!title) {
      return { kind: "failure", failure: { errorClass: "InvalidInput", message: "create-ticket requires `title`", retryable: false } };
    }
    const description = typeof input.description === "string" ? input.description : undefined;
    const assignee = typeof input.assignee === "string" ? input.assignee : undefined;
    const projectId = typeof input.projectId === "string" ? input.projectId : undefined;
    const labels = Array.isArray(input.labels) && input.labels.every((l) => typeof l === "string") ? (input.labels as string[]) : undefined;
    const ticket = this.deps.ticket.resolve(
      typeof input.provider === "string" ? input.provider : undefined,
    );
    ctx.log(`Create ticket "${title}"`);
    const result = await ticket.createTicket({ title, description, assignee, projectId, labels, sessionId: ctx.runId });
    if (result?.error || !result?.ticket) {
      log.error({ result }, "create-ticket failed");
      return { kind: "failure", failure: { errorClass: "CreateTicketFailed", message: String(result?.error ?? "no ticket returned"), retryable: true } };
    }
    return { kind: "success", output: { id: result.ticket.id, url: result.ticket.url, status: result.ticket.status } };
  }
}
