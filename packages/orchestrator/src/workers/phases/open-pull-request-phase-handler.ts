import { createLogger } from "@journeyman/core";
import type { IGitProvider, IPhaseHandler, PhaseContext, PhaseInput, PhaseRunResult, ProviderResolver } from "@journeyman/core";

const log = createLogger("worker:create-pr");

export class OpenPullRequestPhaseHandler implements IPhaseHandler {
  readonly phaseType = "open-pull-request";
  constructor(private deps: { git: ProviderResolver<IGitProvider> }) {}

  async run(input: PhaseInput, ctx: PhaseContext): Promise<PhaseRunResult> {
    const owner = typeof input.owner === "string" ? input.owner : undefined;
    const repo = typeof input.repo === "string" ? input.repo : undefined;
    const title = typeof input.title === "string" ? input.title : undefined;
    const sourceBranch = typeof input.sourceBranch === "string" ? input.sourceBranch : undefined;
    const targetBranch = typeof input.targetBranch === "string" ? input.targetBranch : undefined;
    const body = typeof input.body === "string" ? input.body : undefined;
    if (!owner || !repo || !title || !sourceBranch || !targetBranch) {
      return { kind: "failure", failure: { errorClass: "InvalidInput", message: "create-pr requires owner, repo, title, sourceBranch, targetBranch", retryable: false } };
    }
    const git = this.deps.git.resolve(
      typeof input.provider === "string" ? input.provider : undefined,
    );
    ctx.log(`Creating PR ${owner}/${repo} ${sourceBranch} → ${targetBranch}`);
    const result = await git.createPR({ owner, repo, title, body, sourceBranch, targetBranch, sessionId: ctx.runId });
    if (result?.error) {
      log.error({ result }, "create-pr failed");
      return { kind: "failure", failure: { errorClass: "CreatePrFailed", message: String(result.error), retryable: true } };
    }
    return { kind: "success", output: { id: result.id, url: result.url, number: result.number } };
  }
}
