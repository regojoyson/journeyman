import { createLogger } from "@journeyman/core";
import type { ICodingCLI, IStepHandler, StepContext, StepInput, StepRunResult, ProviderFactory } from "@journeyman/core";
import { SandboxCodingProvider } from "../../sandbox/sandbox-coding-provider.ts";

const log = createLogger("worker:scan-repos");

export class ListWorkspaceFilesStepHandler implements IStepHandler {
  readonly stepType = "list-workspace-files";
  readonly requiresWorkspace = true;
  constructor(private deps: { coding: ProviderFactory<ICodingCLI> }) {}

  async run(input: StepInput, ctx: StepContext): Promise<StepRunResult> {
    const workspaceDir = typeof input.workspaceDir === "string" ? input.workspaceDir : undefined;
    if (!workspaceDir) {
      return { kind: "failure", failure: { errorClass: "InvalidInput", message: "list-workspace-files requires `workspaceDir`", retryable: false } };
    }
    const coding = ctx.exec
      ? new SandboxCodingProvider(ctx.exec)
      : this.deps.coding(typeof input.provider === "string" ? input.provider : undefined, ctx.env);
    ctx.log(`Scanning ${workspaceDir}`);
    const result = await coding.scanRepos({ parentDir: workspaceDir, sessionId: ctx.workflowInstanceId, signal: ctx.signal });
    if (result?.error) {
      log.error({ result }, "scan-repos failed");
      return { kind: "failure", failure: { errorClass: "ScanReposFailed", message: String(result.error), retryable: true } };
    }
    return { kind: "success", output: { repos: result.repos } };
  }
}
