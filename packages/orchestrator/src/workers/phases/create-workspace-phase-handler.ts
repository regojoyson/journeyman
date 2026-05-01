import { createLogger } from "@journeyman/core";
import type {
  ICodingCLI, IPhaseHandler, PhaseContext, PhaseInput, PhaseRunResult, ProviderFactory,
} from "@journeyman/core";

const log = createLogger("worker:create-workspace");

/**
 * Wraps ICodingCLI.createWorkspace.
 *
 * Required input keys:
 *   - ticketId  — used as the workspace folder name (string)
 *   - parentDir — directory under which the workspace is created (string)
 *
 * Returns:
 *   - workspaceDir — absolute path to the created workspace
 *   - folderName   — last path segment
 */
export class CreateWorkspacePhaseHandler implements IPhaseHandler {
  readonly phaseType = "create-workspace";

  constructor(private deps: { coding: ProviderFactory<ICodingCLI> }) {}

  async run(input: PhaseInput, ctx: PhaseContext): Promise<PhaseRunResult> {
    // Accept both editor-vocabulary (name/baseDir) and provider-vocabulary (ticketId/parentDir).
    const ticketId = typeof input.ticketId === "string" ? input.ticketId
      : typeof input.name === "string" ? input.name : undefined;
    const parentDir = typeof input.parentDir === "string" ? input.parentDir
      : typeof input.baseDir === "string" ? input.baseDir : undefined;
    if (!ticketId || !parentDir) {
      return {
        kind: "failure",
        failure: {
          errorClass: "InvalidInput",
          message: "create-workspace requires `ticketId`/`name` and `parentDir`/`baseDir`",
          retryable: false,
        },
      };
    }
    const coding = this.deps.coding(typeof input.provider === "string" ? input.provider : undefined, ctx.env);
    ctx.log(`Creating workspace ${ticketId} under ${parentDir}`);
    const result = await coding.createWorkspace({
      ticketId, parentDir,
      sessionId: ctx.runId, signal: ctx.signal,
    });
    if (result?.error) {
      log.error({ result }, "create-workspace failed");
      return {
        kind: "failure",
        failure: { errorClass: "CreateWorkspaceFailed", message: String(result.error), retryable: true },
      };
    }
    return { kind: "success", output: { workspaceDir: result.dirPath, folderName: result.folderName } };
  }
}
