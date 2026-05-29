import { describe, it, expect } from "vitest";
import { customStepToShape } from "./shape-adapter.ts";
import { workflowInputDefShape, validateInputBinding } from "@journeyman/core";
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

describe("customStepToShape — structured outputs", () => {
  function stepWithOutput(schema: Record<string, unknown>): CustomAiStep {
    return {
      id: "cs2", scope: "org", orgId: "o1", name: "x",
      inputFields: [],
      outputMode: "structured",
      outputSchema: schema,
    } as unknown as CustomAiStep;
  }

  it("opaque object/array output fields → json shapes", () => {
    const { outputSchema } = customStepToShape(stepWithOutput({
      type: "object",
      properties: { obj: { type: "object" }, arr: { type: "array" }, name: { type: "string" } },
    }));
    expect(outputSchema?.obj).toEqual({ type: "json", container: "object", description: undefined });
    expect(outputSchema?.arr).toEqual({ type: "json", container: "array", description: undefined });
    expect(outputSchema?.name).toEqual({ type: "string", description: undefined });
  });

  it("typed object (with properties) stays a typed object", () => {
    const { outputSchema } = customStepToShape(stepWithOutput({
      type: "object",
      properties: { rec: { type: "object", properties: { a: { type: "string" } } } },
    }));
    expect(outputSchema?.rec).toEqual({
      type: "object",
      fields: { a: { type: "string", description: undefined } },
      description: undefined,
    });
  });
});

describe("regression: json-object workflow input binds to json-object custom-step input", () => {
  it("the reported scenario validates clean", () => {
    // Producer: a workflow input declared as `json object`.
    const producer = workflowInputDefShape({ name: "payload", type: "json-object" });
    // Consumer: a custom-step input declared as `json object`.
    const { inputFields } = customStepToShape(stepWith("json-object"));
    const expected = inputFields.payload.shape;

    const check = validateInputBinding(expected, producer);
    expect(check.ok).toBe(true);
  });

  it("a json-array workflow input does NOT bind to a json-object input", () => {
    const producer = workflowInputDefShape({ name: "payload", type: "json-array" });
    const { inputFields } = customStepToShape(stepWith("json-object"));
    const check = validateInputBinding(inputFields.payload.shape, producer);
    expect(check.ok).toBe(false);
  });
});
