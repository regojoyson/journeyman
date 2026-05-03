import { createLogger } from "@journeyman/core";
import type { IIssueProvider, IPhaseHandler, PhaseContext, PhaseInput, PhaseRunResult, ProviderFactory } from "@journeyman/core";

const log = createLogger("worker:add-issue-comment");

export class CommentOnIssuePhaseHandler implements IPhaseHandler {
  readonly phaseType = "comment-on-issue";
  constructor(private deps: { issue: ProviderFactory<IIssueProvider> }) {}

  async run(input: PhaseInput, ctx: PhaseContext): Promise<PhaseRunResult> {
    const id = typeof input.id === "string" ? input.id
      : typeof input.issueRef === "string" ? input.issueRef : undefined;
    const body = typeof input.body === "string" ? input.body : undefined;
    if (!id || !body) {
      return { kind: "failure", failure: { errorClass: "InvalidInput", message: "add-issue-comment requires `id`/`issueRef` and `body`", retryable: false } };
    }
    const issueProvider = this.deps.issue(typeof input.provider === "string" ? input.provider : undefined, ctx.env);
    ctx.log(`Add comment to issue ${id}`);
    const result = await issueProvider.addComment({ id, body, sessionId: ctx.runId });
    if (result?.error) {
      log.error({ result }, "add-issue-comment failed");
      return { kind: "failure", failure: { errorClass: "AddIssueCommentFailed", message: String(result.error), retryable: true } };
    }
    return { kind: "success", output: { commentId: result.comment?.id } };
  }
}
