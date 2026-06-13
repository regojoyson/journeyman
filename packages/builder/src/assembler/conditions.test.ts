import { describe, it, expect } from "vitest";
import { compileCondition } from "./conditions.ts";

describe("compileCondition", () => {
  it("compiles a step-output comparison, remapping the step ref to its node id", () => {
    expect(
      compileCondition(
        { left: { from: "step-output", stepRef: "test", field: "passed" }, op: "==", right: true },
        { test: "n_1" },
      ),
    ).toEqual({ "==": [{ var: "n_1.output.passed" }, true] });
  });

  it("compiles a workflow-input comparison", () => {
    expect(
      compileCondition({ left: { from: "workflow-input", name: "sev" }, op: ">", right: 3 }, {}),
    ).toEqual({ ">": [{ var: "workflow.input.sev" }, 3] });
  });

  it("falls back to the raw stepRef when it is not in the id map", () => {
    expect(
      compileCondition({ left: { from: "step-output", stepRef: "x", field: "y" }, op: "!=", right: null }, {}),
    ).toEqual({ "!=": [{ var: "x.output.y" }, null] });
  });
});
