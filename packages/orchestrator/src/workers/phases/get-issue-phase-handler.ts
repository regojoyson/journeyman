import { createLogger } from "@journeyman/core";
import type {
  IIssueProvider, IPhaseHandler, PhaseContext, PhaseInput, PhaseRunResult,
  ProviderFactory,
} from "@journeyman/core";

const log = createLogger("worker:get-issue");

/**
 * Wraps IIssueProvider.getIssue.
 *
 * Inputs (any of):
 *   - issueRef   — canonical issue ref (e.g. "jira:PROJ-123")
 *   - id         — provider id (string)
 *
 * Returns the Issue object as output.issue.
 */
export class GetIssuePhaseHandler implements IPhaseHandler {
  readonly phaseType = "get-issue";

  constructor(private deps: { issue: ProviderFactory<IIssueProvider> }) {}

  async run(input: PhaseInput, ctx: PhaseContext): Promise<PhaseRunResult> {
    const id = typeof input.id === "string" ? input.id
      : typeof input.issueRef === "string" ? input.issueRef : undefined;
    if (!id) {
      return {
        kind: "failure",
        failure: {
          errorClass: "InvalidInput",
          message: "get-issue requires `issueRef` or `id`",
          retryable: false,
        },
      };
    }
    const issueProvider = this.deps.issue(
      typeof input.provider === "string" ? input.provider : undefined,
      ctx.env,
    );
    ctx.log(`Fetching issue ${id}`);
    const result = await issueProvider.getIssue({ id, sessionId: ctx.runId });
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
