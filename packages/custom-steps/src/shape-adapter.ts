import type {
  CustomAiStep,
  CustomStepInputField,
  CustomStepInputType,
  CustomStepOutputField,
  CustomStepOutputType,
  InputField,
  InputFields,
  OutputSchema,
  Shape,
} from "@journeyman/core";

function inputTypeToShape(t: CustomStepInputType): Shape {
  switch (t) {
    case "string":        return { type: "string" };
    case "number":        return { type: "number" };
    case "boolean":       return { type: "boolean" };
    case "workspaceDir":  return { type: "string" };
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

function outputTypeToShape(t: CustomStepOutputType, desc?: string): Shape {
  switch (t) {
    case "number":      return { type: "number", description: desc };
    case "boolean":     return { type: "boolean", description: desc };
    case "json-object": return { type: "json", container: "object", description: desc };
    case "json-array":  return { type: "json", container: "array", description: desc };
    case "string":      return { type: "string", description: desc };
  }
}

function outputFieldsToShape(fields: CustomStepOutputField[]): OutputSchema {
  const out: OutputSchema = {};
  for (const f of fields) {
    if (!f.name) continue;
    out[f.name] = outputTypeToShape(f.type, f.description);
  }
  return out;
}

export interface CustomStepShape {
  inputFields: InputFields;
  outputSchema: OutputSchema | null;
}

export function customStepToShape(step: CustomAiStep): CustomStepShape {
  const inputFields: InputFields = {};
  for (const f of step.inputFields) inputFields[f.name] = inputFieldToCatalogField(f);

  const outputSchema =
    step.outputMode === "structured" ? outputFieldsToShape(step.outputFields ?? []) :
    step.outputMode === "text"       ? ({ result: { type: "string" } } as OutputSchema) :
    null;

  return { inputFields, outputSchema };
}
