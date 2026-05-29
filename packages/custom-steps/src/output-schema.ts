import type { CustomStepOutputField, CustomStepOutputType, CustomStepJsonSchema } from "@journeyman/core";

/** Editor output field type → JSON Schema `type` keyword. */
function jsonSchemaType(t: CustomStepOutputType): "string" | "number" | "boolean" | "object" | "array" {
  switch (t) {
    case "number":      return "number";
    case "boolean":     return "boolean";
    case "json-object": return "object";
    case "json-array":  return "array";
    case "string":      return "string";
  }
}

/**
 * Build a JSON Schema from a custom step's declared output fields. This is the
 * ONLY place `object`/`array` appear — the schema is generated here and handed
 * straight to the AI SDK's structured-output `outputFormat`. Nothing persists it.
 */
export function outputFieldsToJsonSchema(fields: CustomStepOutputField[]): CustomStepJsonSchema {
  const properties: Record<string, unknown> = {};
  const required: string[] = [];
  for (const field of fields) {
    if (!field.name) continue;
    properties[field.name] = {
      type: jsonSchemaType(field.type),
      ...(field.description ? { description: field.description } : {}),
    };
    if (field.required) required.push(field.name);
  }
  return { type: "object", properties, ...(required.length ? { required } : {}) };
}
