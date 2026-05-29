import type {
  CustomAiStep,
  CustomStepInputField,
  CustomStepInputType,
  CustomStepJsonSchema,
  InputField,
  InputFields,
  OutputSchema,
  Shape,
} from "@journeyman/core";

function inputTypeToShape(t: CustomStepInputType): Shape {
  switch (t) {
    case "string":
    case "template":      return { type: "string" };
    case "number":        return { type: "number" };
    case "boolean":       return { type: "boolean" };
    case "string[]":      return { type: "array", items: { type: "string" } };
    case "workspaceDir":  return { type: "string" };
    case "repoRef":       return { type: "ref", name: "RepoRef" };
    case "json-object":   return { type: "json", container: "object" };
    case "json-array":    return { type: "json", container: "array" };
  }
}

function inputFieldToCatalogField(f: CustomStepInputField): InputField {
  return {
    shape: inputTypeToShape(f.type),
    label: f.description ?? f.name,
    required: f.required,
  };
}

function jsonSchemaToOutputSchema(schema: CustomStepJsonSchema | undefined): OutputSchema | null {
  if (!schema || typeof schema !== "object") return null;
  const props = (schema as { properties?: Record<string, unknown> }).properties;
  if (!props || typeof props !== "object") return null;
  const out: OutputSchema = {};
  for (const [name, raw] of Object.entries(props)) {
    out[name] = jsonSchemaNodeToShape(raw);
  }
  return out;
}

function jsonSchemaNodeToShape(raw: unknown): Shape {
  if (!raw || typeof raw !== "object") return { type: "string" };
  const node = raw as { type?: unknown; items?: unknown; properties?: unknown; description?: unknown };
  const desc = typeof node.description === "string" ? node.description : undefined;
  switch (node.type) {
    case "string":  return { type: "string", description: desc };
    case "number":
    case "integer": return { type: "number", description: desc };
    case "boolean": return { type: "boolean", description: desc };
    case "array": {
      // Opaque array (no declared items) → json array; otherwise a typed array.
      if (node.items == null) return { type: "json", container: "array", description: desc };
      return { type: "array", items: jsonSchemaNodeToShape(node.items), description: desc };
    }
    case "object": {
      const props = node.properties && typeof node.properties === "object" ? node.properties as Record<string, unknown> : {};
      const keys = Object.keys(props);
      // Opaque object (no declared properties) → json object; otherwise a typed object.
      if (keys.length === 0) return { type: "json", container: "object", description: desc };
      const fields: Record<string, Shape> = {};
      for (const [k, v] of Object.entries(props)) fields[k] = jsonSchemaNodeToShape(v);
      return { type: "object", fields, description: desc };
    }
    default: return { type: "string", description: desc };
  }
}

export interface CustomStepShape {
  inputFields: InputFields;
  outputSchema: OutputSchema | null;
}

export function customStepToShape(step: CustomAiStep): CustomStepShape {
  const inputFields: InputFields = {};
  for (const f of step.inputFields) inputFields[f.name] = inputFieldToCatalogField(f);

  const outputSchema =
    step.outputMode === "structured" ? jsonSchemaToOutputSchema(step.outputSchema) :
    step.outputMode === "text"       ? ({ result: { type: "string" } } as OutputSchema) :
    null;

  return { inputFields, outputSchema };
}
