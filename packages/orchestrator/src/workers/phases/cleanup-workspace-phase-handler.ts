import { createLogger } from "@journeyman/core";
import type { ICodingCLI, IPhaseHandler, PhaseContext, PhaseInput, PhaseRunResult, ProviderFactory } from "@journeyman/core";

const log = createLogger("worker:cleanup-repos");

export class CleanupWorkspacePhaseHandler implements IPhaseHandler {
  readonly phaseType = "cleanup-workspace";
  constructor(private deps: { coding: ProviderFactory<ICodingCLI> }) {}

  async run(input: PhaseInput, ctx: PhaseContext): Promise<PhaseRunResult> {
    const workspaceDir = typeof input.workspaceDir === "string" ? input.workspaceDir : undefined;
    if (!workspaceDir) {
      return { kind: "failure", failure: { errorClass: "InvalidInput", message: "cleanup-workspace requires `workspaceDir`", retryable: false } };
    }
    const coding = this.deps.coding(typeof input.provider === "string" ? input.provider : undefined, ctx.env);
    ctx.log(`Scanning workspace ${workspaceDir} before cleanup`);
    const scanResult = await coding.scanRepos({ parentDir: workspaceDir, sessionId: ctx.runId, signal: ctx.signal });
    if (scanResult?.error) {
      log.error({ scanResult }, "cleanup-workspace scan failed");
      return { kind: "failure", failure: { errorClass: "CleanupWorkspaceScanFailed", message: String(scanResult.error), retryable: true } };
    }
    const repos = scanResult.repos.map(r => r.repoDir);
    ctx.log(`Cleaning up ${repos.length} repo(s) in ${workspaceDir}`);
    const result = await coding.cleanupRepos({ repos, sessionId: ctx.runId, signal: ctx.signal });
    if (result?.error) {
      log.error({ result }, "cleanup-repos failed");
      return { kind: "failure", failure: { errorClass: "CleanupReposFailed", message: String(result.error), retryable: true } };
    }
    return { kind: "success", output: { repos: result.repos } };
  }
}
