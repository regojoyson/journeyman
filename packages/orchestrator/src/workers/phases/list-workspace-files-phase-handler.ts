import { createLogger } from "@journeyman/core";
import type { ICodingCLI, IPhaseHandler, PhaseContext, PhaseInput, PhaseRunResult, ProviderFactory } from "@journeyman/core";

const log = createLogger("worker:scan-repos");

export class ListWorkspaceFilesPhaseHandler implements IPhaseHandler {
  readonly phaseType = "list-workspace-files";
  constructor(private deps: { coding: ProviderFactory<ICodingCLI> }) {}

  async run(input: PhaseInput, ctx: PhaseContext): Promise<PhaseRunResult> {
    const workspaceDir = typeof input.workspaceDir === "string" ? input.workspaceDir : undefined;
    if (!workspaceDir) {
      return { kind: "failure", failure: { errorClass: "InvalidInput", message: "list-workspace-files requires `workspaceDir`", retryable: false } };
    }
    const coding = this.deps.coding(typeof input.provider === "string" ? input.provider : undefined, ctx.env);
    ctx.log(`Scanning ${workspaceDir}`);
    const result = await coding.scanRepos({ parentDir: workspaceDir, sessionId: ctx.workflowInstanceId, signal: ctx.signal });
    if (result?.error) {
      log.error({ result }, "scan-repos failed");
      return { kind: "failure", failure: { errorClass: "ScanReposFailed", message: String(result.error), retryable: true } };
    }
    return { kind: "success", output: { repos: result.repos } };
  }
}
