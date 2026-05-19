import type { CustomAiPhase, CustomAiPhaseCreateInput } from "@journeyman/core";
import {
  CUSTOM_PHASE_EXPORT_KIND,
  CUSTOM_PHASE_EXPORT_VERSION,
  type CustomPhaseExportV1,
  type CustomPhaseExportPayloadV1,
} from "@journeyman/core";

export class CustomPhaseImportError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CustomPhaseImportError";
  }
}

function isObject(x: unknown): x is Record<string, unknown> {
  return typeof x === "object" && x !== null && !Array.isArray(x);
}

/**
 * Validates the envelope of a v1 custom-phase export and returns a
 * create-input shaped object. Caller supplies `scope` and ownership.
 * Detailed field validation happens in the existing route handler.
 */
export function fromExportV1(raw: unknown): Omit<CustomAiPhaseCreateInput, "scope"> {
  if (!isObject(raw)) {
    throw new CustomPhaseImportError("Import body must be a JSON object");
  }
  if (raw.kind !== CUSTOM_PHASE_EXPORT_KIND) {
    throw new CustomPhaseImportError(
      `Unexpected kind '${String(raw.kind)}'; expected '${CUSTOM_PHASE_EXPORT_KIND}'`,
    );
  }
  if (raw.schemaVersion !== CUSTOM_PHASE_EXPORT_VERSION) {
    throw new CustomPhaseImportError(
      `Unsupported schemaVersion '${String(raw.schemaVersion)}'; this build accepts ${CUSTOM_PHASE_EXPORT_VERSION}`,
    );
  }
  if (!isObject(raw.phase)) {
    throw new CustomPhaseImportError("Import body is missing 'phase' object");
  }
  const p = raw.phase as Record<string, unknown>;

  return {
    name: p.name as string,
    description: p.description as string | undefined,
    icon: (p.icon ?? null) as string | null,
    inputFields: p.inputFields as CustomAiPhaseCreateInput["inputFields"],
    outputMode: p.outputMode as CustomAiPhaseCreateInput["outputMode"],
    outputSchema: p.outputSchema as CustomAiPhaseCreateInput["outputSchema"],
    promptTemplate: p.promptTemplate as string | undefined,
    defaultTools: p.defaultTools as CustomAiPhaseCreateInput["defaultTools"],
    defaultMcpIds: [],
    defaultSkillIds: [],
    requiresSkills: p.requiresSkills as boolean | undefined,
    requiresMcp: p.requiresMcp as boolean | undefined,
    slots: p.slots as CustomAiPhaseCreateInput["slots"],
  };
}

export function toExportV1(phase: CustomAiPhase): CustomPhaseExportV1 {
  const payload: CustomPhaseExportPayloadV1 = {
    name: phase.name,
    description: phase.description,
    icon: phase.icon ?? null,
    inputFields: phase.inputFields,
    outputMode: phase.outputMode,
    outputSchema: phase.outputSchema,
    promptTemplate: phase.promptTemplate,
    defaultTools: phase.defaultTools,
    defaultMcpIds: [],
    defaultSkillIds: [],
    requiresSkills: phase.requiresSkills,
    requiresMcp: phase.requiresMcp,
    slots: phase.slots,
  };
  return {
    schemaVersion: CUSTOM_PHASE_EXPORT_VERSION,
    kind: CUSTOM_PHASE_EXPORT_KIND,
    exportedAt: new Date().toISOString(),
    exportedFrom: "journeyman",
    phase: payload,
  };
}
