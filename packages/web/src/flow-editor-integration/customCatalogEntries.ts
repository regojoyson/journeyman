import type { CustomAiStep, CanonicalTool } from "@journeyman/core";

/**
 * Synthetic step-catalog entries derived from visible custom steps.
 * The flow editor's palette can merge these alongside built-in steps under a
 * "Custom" category. Each entry creates a `custom-ai` node when dropped, with
 * the customStepId and definition defaults baked in.
 */
export interface CustomStepCatalogEntry {
  stepType: "custom-ai";
  customStepId: string;
  category: "Custom";
  badge: "user" | "org";
  label: string;
  description: string;
  inputFields: CustomAiStep["inputFields"];
  outputMode: CustomAiStep["outputMode"];
  outputSchema: Record<string, unknown>;
  defaultTools: CanonicalTool[];
  defaultMcpIds: string[];
  defaultSkillIds: string[];
}

export function toCatalogEntries(steps: CustomAiStep[]): CustomStepCatalogEntry[] {
  return steps.map((p) => ({
    stepType: "custom-ai" as const,
    customStepId: p.id,
    category: "Custom" as const,
    badge: p.scope,
    label: p.name,
    description: p.description,
    inputFields: p.inputFields,
    outputMode: p.outputMode,
    outputSchema:
      p.outputMode === "structured"
        ? (p.outputSchema ?? {})
        : p.outputMode === "text"
          ? { type: "object", properties: { result: { type: "string" } } }
          : {},
    defaultTools: p.defaultTools,
    defaultMcpIds: p.defaultMcpIds,
    defaultSkillIds: p.defaultSkillIds,
  }));
}
