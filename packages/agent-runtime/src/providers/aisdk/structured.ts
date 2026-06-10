import { Output, jsonSchema } from "ai";

/** Build the AI SDK structured-output spec from a raw JSON Schema, or undefined. */
export function buildOutput(outputSchema: Record<string, unknown> | undefined) {
  if (!outputSchema) return undefined;
  return Output.object({ schema: jsonSchema(outputSchema) });
}
