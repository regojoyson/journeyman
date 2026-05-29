import { describe, it, expect } from "vitest";
import { customStepToShape } from "./shape-adapter.ts";
import type { CustomAiStep } from "@journeyman/core";

function stepWith(type: "json-object" | "json-array"): CustomAiStep {
  return {
    id: "cs1", scope: "org", orgId: "o1", name: "x",
    inputFields: [{ name: "payload", type, required: true }],
    outputMode: "none",
  } as unknown as CustomAiStep;
}

describe("customStepToShape — json inputs", () => {
  it("json-object → json object shape", () => {
    const { inputFields } = customStepToShape(stepWith("json-object"));
    expect(inputFields.payload.shape).toEqual({ type: "json", container: "object" });
  });
  it("json-array → json array shape", () => {
    const { inputFields } = customStepToShape(stepWith("json-array"));
    expect(inputFields.payload.shape).toEqual({ type: "json", container: "array" });
  });
});
