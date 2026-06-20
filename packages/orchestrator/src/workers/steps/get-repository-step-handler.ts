import { createLogger } from "@journeyman/core";
import type { IGitProvider, IStepHandler, StepContext, StepInput, StepRunResult, ProviderFactory } from "@journeyman/core";

const log = createLogger("worker:get-repo");

export class GetRepositoryStepHandler implements IStepHandler {
  readonly stepType = "get-repository";
  constructor(private deps: { git: ProviderFactory<IGitProvider> }) {}

  async run(input: StepInput, ctx: StepContext): Promise<StepRunResult> {
    const owner = typeof input.owner === "string" ? input.owner : undefined;
    const repo = typeof input.repo === "string" ? input.repo : undefined;
    if (!owner || !repo) {
      return { kind: "failure", failure: { errorClass: "InvalidInput", message: "get-repo requires `owner` and `repo`", retryable: false } };
    }
    const git = this.deps.git(ctx.connection?.provider, ctx.env, ctx.connection);
    ctx.log(`Get repo ${owner}/${repo}`);
    const result = await git.getRepo({ owner, repo, sessionId: ctx.workflowInstanceId });
    if (result?.error) {
      log.error({ result }, "get-repo failed");
      return { kind: "failure", failure: { errorClass: "GetRepoFailed", message: String(result.error), retryable: true } };
    }
    return { kind: "success", output: { name: result.name, fullName: result.fullName, url: result.url, defaultBranch: result.defaultBranch } };
  }
}
