import { createLogger } from "@journeyman/core";
import type {
  ICodingCLI, IPhaseHandler, PhaseContext, PhaseInput, PhaseRunResult, ProviderFactory,
} from "@journeyman/core";

const log = createLogger("worker:create-workspace");

/**
 * Wraps ICodingCLI.createWorkspace.
 *
 * Required input keys:
 *   - ticketId — used as the workspace folder name prefix (string)
 *
 * baseDir is read from constructor deps (injected by cli-worker from JOURNEYMAN_BASE_DIR env).
 *
 * Returns:
 *   - workspaceDir — absolute path to the created workspace
 *   - folderName   — last path segment
 */
export class CreateWorkspacePhaseHandler implements IPhaseHandler {
  readonly phaseType = "create-workspace";

  constructor(private deps: { coding: ProviderFactory<ICodingCLI>; baseDir: string }) {}

  async run(input: PhaseInput, ctx: PhaseContext): Promise<PhaseRunResult> {
    const ticketId = typeof input.ticketId === "string" ? input.ticketId : undefined;
    if (!ticketId) {
      return {
        kind: "failure",
        failure: {
          errorClass: "InvalidInput",
          message: "create-workspace requires `ticketId`",
          retryable: false,
        },
      };
    }
    const coding = this.deps.coding(typeof input.provider === "string" ? input.provider : undefined, ctx.env);
    ctx.log(`Creating workspace ${ticketId} under ${this.deps.baseDir}`);
    const result = await coding.createWorkspace({
      ticketId,
      baseDir: this.deps.baseDir,
      sessionId: ctx.runId,
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
