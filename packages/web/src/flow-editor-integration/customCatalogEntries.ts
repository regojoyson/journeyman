import type { CustomAiPhase, CanonicalTool } from "@journeyman/core";

/**
 * Synthetic phase-catalog entries derived from visible custom phases.
 * The flow editor's palette can merge these alongside built-in phases under a
 * "Custom" category. Each entry creates a `custom-ai` node when dropped, with
 * the customPhaseId and definition defaults baked in.
 */
export interface CustomPhaseCatalogEntry {
  phaseType: "custom-ai";
  customPhaseId: string;
  category: "Custom";
  badge: "user" | "org";
  label: string;
  description: string;
  inputFields: CustomAiPhase["inputFields"];
  outputMode: CustomAiPhase["outputMode"];
  outputSchema: Record<string, unknown>;
  defaultTools: CanonicalTool[];
  defaultMcpIds: string[];
  defaultSkillIds: string[];
}

export function toCatalogEntries(phases: CustomAiPhase[]): CustomPhaseCatalogEntry[] {
  return phases.map((p) => ({
    phaseType: "custom-ai" as const,
    customPhaseId: p.id,
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
