import type { CustomAiStep } from "@journeyman/core";

export class MissingRequiredInputError extends Error {
  constructor(name: string) {
    super(`Missing required input: ${name}`);
    this.name = "MissingRequiredInputError";
  }
}

export function renderPrompt(
  step: CustomAiStep,
  values: Record<string, unknown>,
): string {
  for (const field of step.inputFields) {
    if (field.required && (values[field.name] === undefined || values[field.name] === null)) {
      if (field.default === undefined) {
        throw new MissingRequiredInputError(field.name);
      }
    }
  }
  return step.promptTemplate.replace(/\{\{\s*([a-zA-Z_$][\w$]*)\s*\}\}/g, (match, name) => {
    const v = values[name] ?? step.inputFields.find((f) => f.name === name)?.default;
    if (v === undefined || v === null) return match;
    if (typeof v === "string") return v;
    if (typeof v === "number" || typeof v === "boolean") return String(v);
    return JSON.stringify(v, null, 2);
  });
}
