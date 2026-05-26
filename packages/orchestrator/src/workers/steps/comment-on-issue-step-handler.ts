import { createLogger } from "@journeyman/core";
import type { IIssueProvider, IStepHandler, StepContext, StepInput, StepRunResult, ProviderFactory } from "@journeyman/core";

const log = createLogger("worker:add-issue-comment");

export class CommentOnIssueStepHandler implements IStepHandler {
  readonly stepType = "comment-on-issue";
  constructor(private deps: { issue: ProviderFactory<IIssueProvider> }) {}

  async run(input: StepInput, ctx: StepContext): Promise<StepRunResult> {
    const ref = typeof input.ref === "string" ? input.ref : undefined;
    const body = typeof input.body === "string" ? input.body : undefined;
    if (!ref || !body) {
      return { kind: "failure", failure: { errorClass: "InvalidInput", message: "add-issue-comment requires `ref` and `body`", retryable: false } };
    }
    const issueProvider = this.deps.issue(typeof input.provider === "string" ? input.provider : undefined, ctx.env);
    ctx.log(`Add comment to issue ${ref}`);
    const result = await issueProvider.addComment({ id: ref, body, sessionId: ctx.workflowInstanceId });
    if (result?.error) {
      log.error({ result }, "add-issue-comment failed");
      return { kind: "failure", failure: { errorClass: "AddIssueCommentFailed", message: String(result.error), retryable: true } };
    }
    return { kind: "success", output: { commentId: result.comment?.id } };
  }
}
