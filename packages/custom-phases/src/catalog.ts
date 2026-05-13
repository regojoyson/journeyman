import type { Pool } from "pg";
import type { CustomAiPhase, CanonicalTool, SecretSlotDef } from "@journeyman/core";
import { listVisibleCustomAiPhases } from "./db.ts";

export interface CustomPhaseCatalogEntry {
  phaseType: "custom-ai";
  customPhaseId: string;
  scopeBadge: "user" | "org";
  category: "Custom";
  label: string;
  description: string;
  inputFields: CustomAiPhase["inputFields"];
  outputMode: CustomAiPhase["outputMode"];
  outputSchema?: CustomAiPhase["outputSchema"];
  defaultTools: CanonicalTool[];
  defaultMcpIds: string[];
  defaultSkillIds: string[];
  slots: SecretSlotDef[];
}

export async function buildCustomPhaseCatalog(
  pool: Pool,
  ctx: { orgId: string; userId: string },
): Promise<CustomPhaseCatalogEntry[]> {
  const phases = await listVisibleCustomAiPhases(pool, ctx.orgId, ctx.userId);
  return phases.map((p) => ({
    phaseType: "custom-ai" as const,
    customPhaseId: p.id,
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
  }));
}
