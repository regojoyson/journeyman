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
 *   - ref    — provider-native identifier (string, required)
 *   - status — new status (string, required)
 *
 * Returns the updated issue fields.
 */
export class TransitionIssueStepHandler implements IStepHandler {
  readonly stepType = "transition-issue";

  constructor(private deps: { issue: ProviderFactory<IIssueProvider> }) {}

  async run(input: StepInput, ctx: StepContext): Promise<StepRunResult> {
    const ref = typeof input.ref === "string" ? input.ref : undefined;
    const status = typeof input.status === "string" ? input.status : undefined;
    if (!ref || !status) {
      return {
        kind: "failure",
        failure: {
          errorClass: "InvalidInput",
          message: "update-status requires `ref` and `status`",
          retryable: false,
        },
      };
    }
    const issueProvider = this.deps.issue(typeof input.provider === "string" ? input.provider : undefined, ctx.env);
    ctx.log(`Updating issue ${ref} → ${status}`);
    const result = await issueProvider.updateStatus({ id: ref, status, sessionId: ctx.workflowInstanceId });
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
        id: result.issue?.id ?? ref,
        status: result.issue?.status ?? status,
      },
    };
  }
}
