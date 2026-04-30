import { createLogger } from "@journeyman/core";
import type { ICodingCLI, IPhaseHandler, PhaseContext, PhaseInput, PhaseRunResult, ProviderResolver } from "@journeyman/core";

const log = createLogger("worker:commit-push");

export class CommitAndPushPhaseHandler implements IPhaseHandler {
  readonly phaseType = "commit-and-push";
  constructor(private deps: { coding: ProviderResolver<ICodingCLI> }) {}

  async run(input: PhaseInput, ctx: PhaseContext): Promise<PhaseRunResult> {
    const reposRaw = input.repos;
    let repos: string | string[] | undefined;
    if (typeof reposRaw === "string") repos = reposRaw;
    else if (Array.isArray(reposRaw) && reposRaw.every((r) => typeof r === "string")) repos = reposRaw as string[];
    if (!repos) {
      return { kind: "failure", failure: { errorClass: "InvalidInput", message: "commit-push requires `repos` (string|string[])", retryable: false } };
    }
    const ticket = typeof input.ticket === "string" ? input.ticket : undefined;
    const pattern = typeof input.pattern === "string" ? input.pattern : undefined;
    const coding = this.deps.coding.resolve(
      typeof input.provider === "string" ? input.provider : undefined,
    );
    ctx.log(`Commit + push ${typeof repos === "string" ? repos : repos.length + " repos"}`);
    const result = await coding.commitPushRepos({ repos, ticket, pattern, sessionId: ctx.runId, signal: ctx.signal });
    if (result?.error) {
      log.error({ result }, "commit-push failed");
      return { kind: "failure", failure: { errorClass: "CommitPushFailed", message: String(result.error), retryable: true } };
    }
    return { kind: "success", output: { repos: result.repos } };
  }
}
