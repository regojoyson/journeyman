import { BasePhase } from "./base-phase.ts";
import type { PhaseResult, PipelineContext } from "@journeyman/core";

type Config = { artifact: string; field?: string };

/**
 * Gate phase: blocks if a named artifact (or field inside it) is missing/empty.
 * Useful for enforcing preconditions like "analysis.reportPath must exist".
 */
export class RequireFieldPhase extends BasePhase {
  readonly name = "requireField";
  static reads = [] as const;
  static writes = [] as const;

  async run(ctx: PipelineContext, config: Config): Promise<PhaseResult> {
    const v = ctx.artifacts[config.artifact];
    if (v === undefined || v === null) {
      return this.blocked(`missing artifact "${config.artifact}"`, "manual");
    }
    if (config.field) {
      const inner = (v as any)?.[config.field];
      if (inner === undefined || inner === null || (typeof inner === "string" && !inner.trim())) {
        return this.blocked(`artifact "${config.artifact}.${config.field}" is empty`, "manual");
      }
    }
    return this.ok({});
  }
}
