import { createLogger } from "@journeyman/core";
import type {
  IIssueProvider, IStepHandler, StepContext, StepInput, StepRunResult,
  ProviderFactory,
} from "@journeyman/core";

const log = createLogger("worker:update-status");

/**
 * Wraps IIssueProvider.updateStatus.
 *
 * Inputs:
 *   - issueRef | id — issue identifier (string, required)
 *   - status         — new status (string, required)
 *
 * Returns the updated issue fields.
 */
export class TransitionIssueStepHandler implements IStepHandler {
  readonly stepType = "transition-issue";

  constructor(private deps: { issue: ProviderFactory<IIssueProvider> }) {}

  async run(input: StepInput, ctx: StepContext): Promise<StepRunResult> {
    const id = typeof input.id === "string" ? input.id
      : typeof input.issueRef === "string" ? input.issueRef : undefined;
    const status = typeof input.status === "string" ? input.status : undefined;
    if (!id || !status) {
      return {
        kind: "failure",
        failure: {
          errorClass: "InvalidInput",
          message: "update-status requires `issueRef`/`id` and `status`",
          retryable: false,
        },
      };
    }
    const issueProvider = this.deps.issue(typeof input.provider === "string" ? input.provider : undefined, ctx.env);
    ctx.log(`Updating issue ${id} → ${status}`);
    const result = await issueProvider.updateStatus({ id, status, sessionId: ctx.workflowInstanceId });
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
        id: result.issue?.id ?? id,
        status: result.issue?.status ?? status,
      },
    };
  }
}
