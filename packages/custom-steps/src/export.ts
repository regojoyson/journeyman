import type { CustomAiStep, CustomAiStepCreateInput } from "@journeyman/core";
import {
  CUSTOM_STEP_EXPORT_KIND,
  CUSTOM_STEP_EXPORT_VERSION,
  type CustomStepExportV1,
  type CustomStepExportPayloadV1,
} from "@journeyman/core";

export class CustomStepImportError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CustomStepImportError";
  }
}

function isObject(x: unknown): x is Record<string, unknown> {
  return typeof x === "object" && x !== null && !Array.isArray(x);
}

/**
 * Validates the envelope of a v1 custom-step export and returns a
 * create-input shaped object. Caller supplies `scope` and ownership.
 * Detailed field validation happens in the existing route handler.
 */
export function fromExportV1(raw: unknown): Omit<CustomAiStepCreateInput, "scope"> {
  if (!isObject(raw)) {
    throw new CustomStepImportError("Import body must be a JSON object");
  }
  if (raw.kind !== CUSTOM_STEP_EXPORT_KIND) {
    throw new CustomStepImportError(
      `Unexpected kind '${String(raw.kind)}'; expected '${CUSTOM_STEP_EXPORT_KIND}'`,
    );
  }
  if (raw.schemaVersion !== CUSTOM_STEP_EXPORT_VERSION) {
    throw new CustomStepImportError(
      `Unsupported schemaVersion '${String(raw.schemaVersion)}'; this build accepts ${CUSTOM_STEP_EXPORT_VERSION}`,
    );
  }
  if (!isObject(raw.step)) {
    throw new CustomStepImportError("Import body is missing 'step' object");
  }
  const p = raw.step as Record<string, unknown>;

  return {
    name: p.name as string,
    description: p.description as string | undefined,
    icon: (p.icon ?? null) as string | null,
    inputFields: p.inputFields as CustomAiStepCreateInput["inputFields"],
    outputMode: p.outputMode as CustomAiStepCreateInput["outputMode"],
    outputSchema: p.outputSchema as CustomAiStepCreateInput["outputSchema"],
    promptTemplate: p.promptTemplate as string | undefined,
    defaultTools: p.defaultTools as CustomAiStepCreateInput["defaultTools"],
    defaultMcpIds: [],
    defaultSkillIds: [],
    requiresSkills: p.requiresSkills as boolean | undefined,
    requiresMcp: p.requiresMcp as boolean | undefined,
    slots: p.slots as CustomAiStepCreateInput["slots"],
  };
}

export function toExportV1(step: CustomAiStep): CustomStepExportV1 {
  const payload: CustomStepExportPayloadV1 = {
    name: step.name,
    description: step.description,
    icon: step.icon ?? null,
    inputFields: step.inputFields,
    outputMode: step.outputMode,
    outputSchema: step.outputSchema,
    promptTemplate: step.promptTemplate,
    defaultTools: step.defaultTools,
    defaultMcpIds: [],
    defaultSkillIds: [],
    requiresSkills: step.requiresSkills,
    requiresMcp: step.requiresMcp,
    slots: step.slots,
  };
  return {
    schemaVersion: CUSTOM_STEP_EXPORT_VERSION,
    kind: CUSTOM_STEP_EXPORT_KIND,
    exportedAt: new Date().toISOString(),
    exportedFrom: "journeyman",
    step: payload,
  };
}
