import { createLogger } from "@journeyman/core";
import type { ICodingCLI, IPhaseHandler, PhaseContext, PhaseInput, PhaseRunResult, ProviderFactory } from "@journeyman/core";

const log = createLogger("worker:cleanup-repos");

export class CleanupWorkspacePhaseHandler implements IPhaseHandler {
  readonly phaseType = "cleanup-workspace";
  constructor(private deps: { coding: ProviderFactory<ICodingCLI> }) {}

  async run(input: PhaseInput, ctx: PhaseContext): Promise<PhaseRunResult> {
    const reposRaw = input.repos;
    let repos: string | string[] | undefined;
    if (typeof reposRaw === "string") repos = reposRaw;
    else if (Array.isArray(reposRaw) && reposRaw.every((r) => typeof r === "string")) repos = reposRaw as string[];
    if (!repos) {
      return { kind: "failure", failure: { errorClass: "InvalidInput", message: "cleanup-repos requires `repos`", retryable: false } };
    }
    const coding = this.deps.coding(typeof input.provider === "string" ? input.provider : undefined, ctx.env);
    ctx.log(`Cleaning up repos`);
    const result = await coding.cleanupRepos({ repos, sessionId: ctx.runId, signal: ctx.signal });
    if (result?.error) {
      log.error({ result }, "cleanup-repos failed");
      return { kind: "failure", failure: { errorClass: "CleanupReposFailed", message: String(result.error), retryable: true } };
    }
    return { kind: "success", output: { repos: result.repos } };
  }
}
