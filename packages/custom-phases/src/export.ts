import type { CustomAiPhase } from "@journeyman/core";
import {
  CUSTOM_PHASE_EXPORT_KIND,
  CUSTOM_PHASE_EXPORT_VERSION,
  type CustomPhaseExportV1,
  type CustomPhaseExportPayloadV1,
} from "@journeyman/core";

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
