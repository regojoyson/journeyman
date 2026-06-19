import { describe, it, expect } from "vitest";
import { shapesFromProposedSteps } from "./proposed-custom-steps.ts";
import type { ProposedCustomStep } from "@journeyman/core";

describe("shapesFromProposedSteps", () => {
  it("returns an empty map for undefined", () => {
    expect(shapesFromProposedSteps(undefined).size).toBe(0);
  });

  it("builds a shape keyed by the placeholder id, with declared input fields", () => {
    const proposed: ProposedCustomStep[] = [
      {
        id: "tmp-sec",
        step: {
          name: "Security review",
          inputFields: [{ name: "diff", type: "string", required: true }],
          outputMode: "structured",
          outputFields: [{ name: "findings", type: "json-array", required: true }],
        },
      },
    ];
    const map = shapesFromProposedSteps(proposed);
    expect(map.has("tmp-sec")).toBe(true);
    expect(map.get("tmp-sec")!.inputFields).toHaveProperty("diff");
    expect(map.get("tmp-sec")!.outputSchema).not.toBeNull();
  });

  it("defaults missing inputFields/outputMode safely", () => {
    const map = shapesFromProposedSteps([{ id: "x", step: { name: "Bare" } }]);
    expect(map.has("x")).toBe(true);
    expect(map.get("x")!.outputSchema).toBeNull(); // outputMode defaults to "none"
  });
});
