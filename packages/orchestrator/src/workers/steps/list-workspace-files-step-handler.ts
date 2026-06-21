import type { Pool } from "pg";
import { createLogger } from "@journeyman/core";
import type { ICodingCLI, IStepHandler, StepContext, StepInput, StepRunResult, ProviderFactory } from "@journeyman/core";
import { SandboxInstanceCodingProvider } from "../../sandbox/sandbox-instance-coding-provider.ts";
import { recordTokenUsage } from "../../usage/record-token-usage.ts";

const log = createLogger("worker:scan-repos");

export class ListWorkspaceFilesStepHandler implements IStepHandler {
  readonly stepType = "list-workspace-files";
  readonly requiresWorkspace = true;
  constructor(private deps: { coding: ProviderFactory<ICodingCLI>; pool?: Pool }) {}

  async run(input: StepInput, ctx: StepContext): Promise<StepRunResult> {
    const workspaceDir = ctx.workspaceDir;
    const coding = ctx.exec
      ? new SandboxInstanceCodingProvider(ctx.exec)
      : this.deps.coding(typeof input.provider === "string" ? input.provider : undefined, ctx.env);
    ctx.log(`Scanning ${workspaceDir}`);
    const result = await coding.scanRepos({ parentDir: workspaceDir, sessionId: ctx.workflowInstanceId, signal: ctx.signal });
    const outcome: "success" | "error" | "aborted" =
      ctx.signal.aborted ? "aborted" : result?.error ? "error" : "success";
    await recordTokenUsage(this.deps.pool, {
      workspaceId: typeof input.workspaceId === "string" ? input.workspaceId : null,
      orgId: typeof input.startedByOrgId === "string" ? input.startedByOrgId : null,
      workflowId: typeof input.workflowId === "string" ? input.workflowId : null,
      workflowVersionId: null, workflowName: null,
      workflowInstanceId: ctx.workflowInstanceId, nodeId: ctx.nodeId, stepType: this.stepType,
      stepName: null, attempt: ctx.attempt,
      agentId: typeof input.agentId === "string" ? input.agentId : null,
      agentName: typeof input.displayName === "string" ? input.displayName : null,
      triggeredByUserId: typeof input.startedByUserId === "string" ? input.startedByUserId : null,
      outcome, provider: typeof input.provider === "string" ? input.provider : "claude",
      requestedModel: typeof input.model === "string" ? input.model : null,
      usage: result.usage ?? [],
    });
    if (result?.error) {
      log.error({ result }, "scan-repos failed");
      return { kind: "failure", failure: { errorClass: "ScanReposFailed", message: String(result.error), retryable: true } };
    }
    return { kind: "success", output: { repos: result.repos } };
  }
}
