import { useMemo } from "react";
import type { ValidationCatalog, CustomPhaseValidationEntry, WorkflowGraph, CustomAiPhase } from "@journeyman/core";
import { usePhaseCatalog } from "../catalogs/use-phase-catalog.ts";
import { useCustomPhaseDefs } from "../catalogs/use-custom-phase-defs.ts";

function collectCustomPhaseIds(flow: WorkflowGraph | null | undefined): string[] {
  if (!flow) return [];
  const ids = new Set<string>();
  for (const n of flow.nodes) {
    if (n.type !== "phase" || n.phaseType !== "custom-ai") continue;
    const id = (n.config as { customPhaseId?: unknown } | undefined)?.customPhaseId;
    if (typeof id === "string" && id) ids.add(id);
  }
  return Array.from(ids);
}

/**
 * Adapter: presents the editor's phase catalog as a ValidationCatalog
 * for the @journeyman/core flow-validator. Adds per-customPhaseId metadata
 * (requiresSkills, defaultSkillIds) onto the "custom-ai" entry so the
 * validator can emit a missing-required warning when a flag-on phase has
 * no skills attached.
 */
export function useValidationCatalog(flow?: WorkflowGraph | null): ValidationCatalog {
  const catalog = usePhaseCatalog();
  const customIds = useMemo(() => collectCustomPhaseIds(flow), [flow]);
  const defs = useCustomPhaseDefs(customIds);

  return useMemo(() => {
    const out: ValidationCatalog = {};
    for (const [phaseType, entry] of Object.entries(catalog)) {
      out[phaseType] = {
        inputFields: entry.inputFields,
        outputSchema: entry.outputSchema,
      };
    }
    const customPhases: Record<string, CustomPhaseValidationEntry> = {};
    for (const [id, def] of Object.entries(defs)) {
      if (!def) continue;
      const d = def as CustomAiPhase;
      customPhases[id] = {
        name: d.name,
        requiresSkills: d.requiresSkills ?? false,
        defaultSkillIds: d.defaultSkillIds ?? [],
        requiresMcp: d.requiresMcp ?? false,
        defaultMcpIds: d.defaultMcpIds ?? [],
      };
    }
    out["custom-ai"] = { ...(out["custom-ai"] ?? {}), customPhases };
    return out;
  }, [catalog, defs]);
}
