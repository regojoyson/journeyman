import { BasePhase } from "./base-phase.ts";
import { unwrapField } from "../adapter-unwrap.ts";
import type { PhaseResult, PipelineContext } from "@journeyman/core";

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
