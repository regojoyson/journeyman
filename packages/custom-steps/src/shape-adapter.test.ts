import { describe, it, expect } from "vitest";
import { customStepToShape } from "./shape-adapter.ts";
import { outputFieldsToJsonSchema } from "./output-schema.ts";
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
  function stepWithOutputFields(fields: Array<{ name: string; type: any; required?: boolean }>): CustomAiStep {
    return {
      id: "cs2", scope: "org", orgId: "o1", name: "x",
      inputFields: [],
      outputMode: "structured",
      outputFields: fields.map(f => ({ required: false, ...f })),
    } as unknown as CustomAiStep;
  }

  it("output fields map to binding shapes (json containers stay opaque)", () => {
    const { outputSchema } = customStepToShape(stepWithOutputFields([
      { name: "obj", type: "json-object" },
      { name: "arr", type: "json-array" },
      { name: "name", type: "string" },
    ]));
    expect(outputSchema?.obj).toEqual({ type: "json", container: "object", description: undefined });
    expect(outputSchema?.arr).toEqual({ type: "json", container: "array", description: undefined });
    expect(outputSchema?.name).toEqual({ type: "string", description: undefined });
  });

  it("text mode → { result: string }", () => {
    const step = { id: "c", scope: "org", orgId: "o", name: "x", inputFields: [], outputMode: "text" } as unknown as CustomAiStep;
    expect(customStepToShape(step).outputSchema).toEqual({ result: { type: "string" } });
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

  it("output path: clean field → valid model JSON Schema AND a bindable json shape", () => {
    const step = {
      id: "c", scope: "org", orgId: "o", name: "x", inputFields: [],
      outputMode: "structured",
      outputFields: [{ name: "result", type: "json-object", required: true }],
    } as unknown as CustomAiStep;

    // What the AI model receives must be standard JSON Schema (object), never "json-object".
    const schema = outputFieldsToJsonSchema(step.outputFields!);
    expect((schema as any).properties.result).toEqual({ type: "object" });

    // What the picker sees is an opaque json object that binds to a json-object input.
    const outShape = customStepToShape(step).outputSchema!.result;
    const consumer = workflowInputDefShape({ name: "x", type: "json-object" });
    expect(validateInputBinding(consumer, outShape).ok).toBe(true);
  });
});
