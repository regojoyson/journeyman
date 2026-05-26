import { createLogger } from "@journeyman/core";
import type {
  ICodingCLI, IStepHandler, StepContext, StepInput, StepRunResult, ProviderFactory,
} from "@journeyman/core";

const log = createLogger("worker:create-workspace");

/**
 * Wraps ICodingCLI.createWorkspace.
 *
 * Required input keys:
 *   - ref — used as the workspace folder name prefix (string)
 *
 * baseDir is read from constructor deps (injected by cli-worker from JOURNEYMAN_BASE_DIR env).
 *
 * Returns:
 *   - workspaceDir — absolute path to the created workspace
 *   - folderName   — last path segment
 */
export class CreateWorkspaceStepHandler implements IStepHandler {
  readonly stepType = "create-workspace";

  constructor(private deps: { coding: ProviderFactory<ICodingCLI>; baseDir: string }) {}

  async run(input: StepInput, ctx: StepContext): Promise<StepRunResult> {
    const ref = typeof input.ref === "string" ? input.ref : undefined;
    if (!ref) {
      return {
        kind: "failure",
        failure: {
          errorClass: "InvalidInput",
          message: "create-workspace requires `ref`",
          retryable: false,
        },
      };
    }
    const coding = this.deps.coding(typeof input.provider === "string" ? input.provider : undefined, ctx.env);
    ctx.log(`Creating workspace ${ref} under ${this.deps.baseDir}`);
    const result = await coding.createWorkspace({
      ref,
      baseDir: this.deps.baseDir,
      sessionId: ctx.workflowInstanceId,
      signal: ctx.signal,
    });
    if (result?.error) {
      log.error({ result }, "create-workspace failed");
      return {
        kind: "failure",
        failure: { errorClass: "CreateWorkspaceFailed", message: String(result.error), retryable: true },
      };
    }
    return { kind: "success", output: { workspaceDir: result.repoDir, folderName: result.folderName } };
  }
}
