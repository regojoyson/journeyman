import { createLogger } from "@journeyman/core";
import type { IGitProvider, IPhaseHandler, PhaseContext, PhaseInput, PhaseRunResult, ProviderResolver } from "@journeyman/core";

const log = createLogger("worker:list-prs");

export class ListPullRequestsPhaseHandler implements IPhaseHandler {
  readonly phaseType = "list-pull-requests";
  constructor(private deps: { git: ProviderResolver<IGitProvider> }) {}

  async run(input: PhaseInput, ctx: PhaseContext): Promise<PhaseRunResult> {
    const owner = typeof input.owner === "string" ? input.owner : undefined;
    const repo = typeof input.repo === "string" ? input.repo : undefined;
    const head = typeof input.head === "string" ? input.head : undefined;
    const state = input.state === "open" || input.state === "closed" || input.state === "all" ? input.state : undefined;
    if (!owner || !repo) {
      return { kind: "failure", failure: { errorClass: "InvalidInput", message: "list-prs requires `owner` and `repo`", retryable: false } };
    }
    const git = this.deps.git.resolve(
      typeof input.provider === "string" ? input.provider : undefined,
    );
    ctx.log(`List PRs ${owner}/${repo}`);
    const result = await git.listPRs({ owner, repo, head, state, sessionId: ctx.runId });
    if (result?.error) {
      log.error({ result }, "list-prs failed");
      return { kind: "failure", failure: { errorClass: "ListPrsFailed", message: String(result.error), retryable: true } };
    }
    return { kind: "success", output: { prs: result.prs } };
  }
}
