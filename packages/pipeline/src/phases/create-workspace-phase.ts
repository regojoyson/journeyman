/**
 * @file create-workspace-phase.ts
 * Creates a dedicated workspace directory for the current ticket via the coding-cli provider.
 *
 * Reads:  none.
 * Writes: workspacePath — absolute path of the newly created workspace directory.
 */

import { BasePhase } from "./base-phase.ts";
import { unwrapField } from "../adapter-unwrap.ts";
import type { PhaseResult, PipelineContext } from "@journeyman/core";

/**
 * Creates a ticket-scoped workspace directory under `ctx.workspaceDir`.
 *
 * The provider is responsible for naming and creating the directory. The
 * returned `dirPath` is stored as `workspacePath` and can be used by
 * subsequent phases (e.g. cloneRepos) as a target location.
 *
 * Failure modes:
 * - Provider returns no `dirPath` → unwrapField throws AdapterError.
 * - Disk permission error or path conflict → provider propagates as error field.
 * - Aborted via `ctx.signal` → provider raises AbortError.
 *
 * Side effects: creates a directory on disk.
 */
export class CreateWorkspacePhase extends BasePhase {
  readonly name = "createWorkspace";
  static reads = [] as const;
  static writes = ["workspacePath"] as const;

  async run(ctx: PipelineContext): Promise<PhaseResult> {
    const res = await ctx.providers.coding.createWorkspace({
      ticketId: ctx.ticketKey,
      parentDir: ctx.workspaceDir,
      sessionId: ctx.sessionId,
      signal: ctx.signal,
    });

    const dirPath = unwrapField(res, "dirPath", "createWorkspace");
    return this.ok({ workspacePath: dirPath });
  }
}
