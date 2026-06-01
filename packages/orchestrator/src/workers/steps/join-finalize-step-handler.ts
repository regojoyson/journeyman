import type { IStepHandler, StepInput, StepContext, StepRunResult, JoinMode } from "@journeyman/core";
import { materializeJoinOutput } from "./join-finalize.ts";

/**
 * Synthetic step emitted by the converter after a field-bearing JOIN. Reads the
 * raw Conductor JOIN branch map and computes the documented {winner, output,
 * results} shape so downstream `join_<id>.output.*` refs resolve.
 */
export class JoinFinalizeStepHandler implements IStepHandler {
  readonly stepType = "join-finalize";

  async run(input: StepInput, _ctx: StepContext): Promise<StepRunResult> {
    const mode = input.mode as JoinMode | undefined;
    const raw = (typeof input.raw === "object" && input.raw !== null ? input.raw : {}) as Record<string, unknown>;
    const branchTaskRefs = input.branchTaskRefs;
    if (!mode || !Array.isArray(branchTaskRefs)) {
      return {
        kind: "failure",
        failure: { errorClass: "InvalidInput", message: "join-finalize requires `mode` and `branchTaskRefs`", retryable: false },
      };
    }
    const output = materializeJoinOutput(mode, raw, branchTaskRefs as string[][]);
    return { kind: "success", output: output as Record<string, unknown> };
  }
}
