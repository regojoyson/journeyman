import { describe, it, expect } from "vitest";
import { JoinFinalizeStepHandler } from "./join-finalize-step-handler.ts";
import type { StepContext } from "@journeyman/core";

const ctx = {
  workflowInstanceId: "wf", nodeId: "join", attempt: 1, workspaceDir: "/tmp",
  signal: new AbortController().signal, env: {}, workflowInputs: {}, log: () => {},
} as unknown as StepContext;

describe("JoinFinalizeStepHandler", () => {
  it("declares stepType join-finalize", () => {
    expect(new JoinFinalizeStepHandler().stepType).toBe("join-finalize");
  });

  it("delegates to materializeJoinOutput and returns success", async () => {
    const res = await new JoinFinalizeStepHandler().run(
      { mode: "first-wins", raw: { a: { v: 1 } }, branchTaskRefs: [["a"]] },
      ctx,
    );
    expect(res.kind).toBe("success");
    if (res.kind === "success") {
      expect(res.output.winner).toBe("a");
      expect(res.output.output).toEqual({ v: 1 });
    }
  });

  it("fails with InvalidInput when branchTaskRefs is missing", async () => {
    const res = await new JoinFinalizeStepHandler().run({ mode: "first-wins", raw: {} }, ctx);
    expect(res.kind).toBe("failure");
    if (res.kind === "failure") {
      expect(res.failure.errorClass).toBe("InvalidInput");
      expect(res.failure.retryable).toBe(false);
    }
  });
});
