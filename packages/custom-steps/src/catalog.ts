import type { Pool } from "pg";
import type { CustomAiStep, CanonicalTool, SecretSlotDef } from "@journeyman/core";
import { listCustomAiSteps } from "./db.ts";

export interface CustomStepCatalogEntry {
  stepType: "custom-ai";
  customStepId: string;
  category: "Custom";
  label: string;
  description: string;
  inputFields: CustomAiStep["inputFields"];
  outputMode: CustomAiStep["outputMode"];
  outputFields?: CustomAiStep["outputFields"];
  defaultTools: CanonicalTool[];
  defaultMcpIds: string[];
  defaultSkillIds: string[];
  slots: SecretSlotDef[];
  requiresSkills: boolean;
  requiresMcp: boolean;
}

export async function buildCustomStepCatalog(
  pool: Pool,
  workspaceId: string,
): Promise<CustomStepCatalogEntry[]> {
  const steps = await listCustomAiSteps(pool, workspaceId);
  return steps.map((p: CustomAiStep) => ({
    stepType: "custom-ai" as const,
    customStepId: p.id,
    category: "Custom" as const,
    label: p.name,
    description: p.description,
    inputFields: p.inputFields,
    outputMode: p.outputMode,
    outputFields: p.outputFields,
    defaultTools: p.defaultTools,
    defaultMcpIds: p.defaultMcpIds,
    defaultSkillIds: p.defaultSkillIds,
    slots: p.slots,
    requiresSkills: p.requiresSkills,
    requiresMcp: p.requiresMcp,
  }));
}
