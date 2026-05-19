import type { Pool } from "pg";
import type { CustomAiStep, CanonicalTool, SecretSlotDef } from "@journeyman/core";
import { listVisibleCustomAiSteps } from "./db.ts";

export interface CustomStepCatalogEntry {
  stepType: "custom-ai";
  customStepId: string;
  scopeBadge: "user" | "org";
  category: "Custom";
  label: string;
  description: string;
  inputFields: CustomAiStep["inputFields"];
  outputMode: CustomAiStep["outputMode"];
  outputSchema?: CustomAiStep["outputSchema"];
  defaultTools: CanonicalTool[];
  defaultMcpIds: string[];
  defaultSkillIds: string[];
  slots: SecretSlotDef[];
  requiresSkills: boolean;
  requiresMcp: boolean;
}

export async function buildCustomStepCatalog(
  pool: Pool,
  ctx: { orgId: string; userId: string },
): Promise<CustomStepCatalogEntry[]> {
  const steps = await listVisibleCustomAiSteps(pool, ctx.orgId, ctx.userId);
  return steps.map((p) => ({
    stepType: "custom-ai" as const,
    customStepId: p.id,
    scopeBadge: p.scope,
    category: "Custom" as const,
    label: p.name,
    description: p.description,
    inputFields: p.inputFields,
    outputMode: p.outputMode,
    outputSchema: p.outputSchema,
    defaultTools: p.defaultTools,
    defaultMcpIds: p.defaultMcpIds,
    defaultSkillIds: p.defaultSkillIds,
    slots: p.slots,
    requiresSkills: p.requiresSkills,
    requiresMcp: p.requiresMcp,
  }));
}
