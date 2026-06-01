import { createLogger } from "@journeyman/core";
import type { ICodingCLI, IStepHandler, StepContext, StepInput, StepRunResult, ProviderFactory } from "@journeyman/core";
import { SandboxCodingProvider } from "../../sandbox/sandbox-coding-provider.ts";

const log = createLogger("worker:cleanup-repos");

export class CleanupWorkspaceStepHandler implements IStepHandler {
  readonly stepType = "cleanup-workspace";
  readonly requiresWorkspace = true;
  constructor(private deps: { coding: ProviderFactory<ICodingCLI> }) {}

  async run(input: StepInput, ctx: StepContext): Promise<StepRunResult> {
    const workspaceDir = typeof input.workspaceDir === "string" ? input.workspaceDir : undefined;
    if (!workspaceDir) {
      return { kind: "failure", failure: { errorClass: "InvalidInput", message: "cleanup-workspace requires `workspaceDir`", retryable: false } };
    }
    const coding = ctx.exec
      ? new SandboxCodingProvider(ctx.exec)
      : this.deps.coding(typeof input.provider === "string" ? input.provider : undefined, ctx.env);
    ctx.log(`Scanning workspace ${workspaceDir} before cleanup`);
    const scanResult = await coding.scanRepos({ parentDir: workspaceDir, sessionId: ctx.workflowInstanceId, signal: ctx.signal });
    if (scanResult?.error) {
      log.error({ scanResult }, "cleanup-workspace scan failed");
      return { kind: "failure", failure: { errorClass: "CleanupWorkspaceScanFailed", message: String(scanResult.error), retryable: true } };
    }
    const repos = scanResult.repos.map(r => r.repoDir);
    ctx.log(`Cleaning up ${repos.length} repo(s) in ${workspaceDir}`);
    const result = await coding.cleanupRepos({ repos, sessionId: ctx.workflowInstanceId, signal: ctx.signal });
    if (result?.error) {
      log.error({ result }, "cleanup-repos failed");
      return { kind: "failure", failure: { errorClass: "CleanupReposFailed", message: String(result.error), retryable: true } };
    }
    return { kind: "success", output: { removed: true } };
  }
}
