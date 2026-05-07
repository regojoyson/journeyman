import { createLogger } from "@journeyman/core";
import type { IGitProvider, IPhaseHandler, PhaseContext, PhaseInput, PhaseRunResult, ProviderFactory } from "@journeyman/core";

const log = createLogger("worker:fetch-pr-comments");

export class ListPullRequestCommentsPhaseHandler implements IPhaseHandler {
  readonly phaseType = "list-pull-request-comments";
  constructor(private deps: { git: ProviderFactory<IGitProvider> }) {}

  async run(input: PhaseInput, ctx: PhaseContext): Promise<PhaseRunResult> {
    const prUrl = typeof input.prUrl === "string" ? input.prUrl : undefined;
    const sinceIso = typeof input.sinceIso === "string" ? input.sinceIso : undefined;
    if (!prUrl) {
      return { kind: "failure", failure: { errorClass: "InvalidInput", message: "fetch-pr-comments requires `prUrl`", retryable: false } };
    }
    const git = this.deps.git(typeof input.provider === "string" ? input.provider : undefined, ctx.env);
    ctx.log(`Fetch PR comments ${prUrl}`);
    const result = await git.listPRComments({ prUrl, sinceIso, sessionId: ctx.workflowInstanceId });
    if (result?.error) {
      log.error({ result }, "fetch-pr-comments failed");
      return { kind: "failure", failure: { errorClass: "FetchPrCommentsFailed", message: String(result.error), retryable: true } };
    }
    return { kind: "success", output: { comments: result.comments } };
  }
}
