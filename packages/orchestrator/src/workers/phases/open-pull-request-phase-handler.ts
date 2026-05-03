import { createLogger } from "@journeyman/core";
import type { IGitProvider, IPhaseHandler, PhaseContext, PhaseInput, PhaseRunResult, ProviderFactory } from "@journeyman/core";

const log = createLogger("worker:create-pr");

export class OpenPullRequestPhaseHandler implements IPhaseHandler {
  readonly phaseType = "open-pull-request";
  constructor(private deps: { git: ProviderFactory<IGitProvider> }) {}

  async run(input: PhaseInput, ctx: PhaseContext): Promise<PhaseRunResult> {
    const owner = typeof input.owner === "string" ? input.owner : undefined;
    const repo = typeof input.repo === "string" ? input.repo : undefined;
    const title = typeof input.title === "string" ? input.title : undefined;
    const head = typeof input.head === "string" ? input.head : undefined;
    const base = typeof input.base === "string" ? input.base : undefined;
    const body = typeof input.body === "string" ? input.body : undefined;
    if (!owner || !repo || !title || !head || !base) {
      return { kind: "failure", failure: { errorClass: "InvalidInput", message: "open-pull-request requires owner, repo, title, head, base", retryable: false } };
    }
    const git = this.deps.git(typeof input.provider === "string" ? input.provider : undefined, ctx.env);
    ctx.log(`Creating PR ${owner}/${repo} ${head} → ${base}`);
    const result = await git.createPR({ owner, repo, title, body, sourceBranch: head, targetBranch: base, sessionId: ctx.runId });
    if (result?.error) {
      log.error({ result }, "create-pr failed");
      return { kind: "failure", failure: { errorClass: "CreatePrFailed", message: String(result.error), retryable: true } };
    }
    return { kind: "success", output: { pullRequest: { id: result.id, url: result.url, number: result.number } } };
  }
}
