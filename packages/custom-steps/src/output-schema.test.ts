import { describe, it, expect } from "vitest";
import { outputFieldsToJsonSchema } from "./output-schema.ts";
import type { CustomStepOutputField } from "@journeyman/core";

const f = (
  name: string,
  type: CustomStepOutputField["type"],
  required = false,
  description?: string,
): CustomStepOutputField => ({ name, type, required, description });

describe("outputFieldsToJsonSchema", () => {
  it("maps scalars and json containers to valid JSON Schema types", () => {
    const schema = outputFieldsToJsonSchema([
      f("title", "string"),
      f("count", "number"),
      f("ok", "boolean"),
      f("payload", "json-object"),
      f("items", "json-array"),
    ]);
    expect(schema).toEqual({
      type: "object",
      properties: {
        title: { type: "string" },
        count: { type: "number" },
        ok: { type: "boolean" },
        payload: { type: "object" },
        items: { type: "array" },
      },
    });
  });

  it("includes a required array only when there are required fields", () => {
    const schema = outputFieldsToJsonSchema([f("a", "string", true), f("b", "string", false)]);
    expect((schema as any).required).toEqual(["a"]);
  });

  it("carries descriptions through", () => {
    const schema = outputFieldsToJsonSchema([f("a", "string", false, "the a")]);
    expect((schema as any).properties.a).toEqual({ type: "string", description: "the a" });
  });

  it("skips empty-named fields and emits an empty object for no fields", () => {
    expect(outputFieldsToJsonSchema([])).toEqual({ type: "object", properties: {} });
    expect(outputFieldsToJsonSchema([f("", "string")])).toEqual({ type: "object", properties: {} });
  });
});
