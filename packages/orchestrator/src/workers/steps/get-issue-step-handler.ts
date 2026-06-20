import { createLogger } from "@journeyman/core";
import type {
  IIssueProvider, IStepHandler, StepContext, StepInput, StepRunResult,
  ProviderFactory,
} from "@journeyman/core";

const log = createLogger("worker:get-issue");

/**
 * Wraps IIssueProvider.getIssue.
 *
 * Input:
 *   - ref — provider-native identifier (e.g. "PROJ-123")
 *
 * Returns the Issue object as output.issue.
 */
export class GetIssueStepHandler implements IStepHandler {
  readonly stepType = "get-issue";

  constructor(private deps: { issue: ProviderFactory<IIssueProvider> }) {}

  async run(input: StepInput, ctx: StepContext): Promise<StepRunResult> {
    const ref = typeof input.ref === "string" ? input.ref : undefined;
    if (!ref) {
      return {
        kind: "failure",
        failure: {
          errorClass: "InvalidInput",
          message: "get-issue requires `ref`",
          retryable: false,
        },
      };
    }
    const issueProvider = this.deps.issue(ctx.connection?.provider, ctx.env, ctx.connection);
    ctx.log(`Fetching issue ${ref}`);
    const result = await issueProvider.getIssue({ id: ref, sessionId: ctx.workflowInstanceId });
    if (result?.error || !result?.issue) {
      log.error({ result }, "get-issue failed");
      const msg = String(result?.error ?? "no issue returned");
      const retryable = !/not found|404/i.test(msg);
      return {
        kind: "failure",
        failure: { errorClass: "GetIssueFailed", message: msg, retryable },
      };
    }
    return {
      kind: "success",
      output: {
        issue: result.issue,
      },
    };
  }
}
