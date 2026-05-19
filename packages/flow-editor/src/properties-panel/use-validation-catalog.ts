import { useMemo } from "react";
import type { ValidationCatalog, CustomStepValidationEntry, WorkflowGraph, CustomAiStep } from "@journeyman/core";
import { customStepToShape } from "@journeyman/custom-steps/shape-adapter";
import { useStepCatalog } from "../catalogs/use-step-catalog.ts";
import { useCustomStepDefs } from "../catalogs/use-custom-step-defs.ts";

function collectCustomStepIds(flow: WorkflowGraph | null | undefined): string[] {
  if (!flow) return [];
  const ids = new Set<string>();
  for (const n of flow.nodes) {
    if (n.type !== "step" || n.stepType !== "custom-ai") continue;
    const id = (n.config as { customStepId?: unknown } | undefined)?.customStepId;
    if (typeof id === "string" && id) ids.add(id);
  }
  return Array.from(ids);
}

/**
 * Adapter: presents the editor.s step catalog as a ValidationCatalog
 * for the @journeyman/core flow-validator. Adds per-customStepId metadata
 * (requiresSkills, defaultSkillIds) onto the "custom-ai" entry so the
 * validator can emit a missing-required warning when a flag-on step has
 * no skills attached.
 */
export function useValidationCatalog(flow?: WorkflowGraph | null): ValidationCatalog {
  const catalog = useStepCatalog();
  const customIds = useMemo(() => collectCustomStepIds(flow), [flow]);
  const defs = useCustomStepDefs(customIds);

  return useMemo(() => {
    const out: ValidationCatalog = {};
    for (const [stepType, entry] of Object.entries(catalog)) {
      out[stepType] = {
        inputFields: entry.inputFields,
        outputSchema: entry.outputSchema,
      };
    }
    const customSteps: Record<string, CustomStepValidationEntry> = {};
    for (const [id, def] of Object.entries(defs)) {
      if (!def) continue;
      const d = def as CustomAiStep;
      const shape = customStepToShape(d);
      customSteps[id] = {
        name: d.name,
        requiresSkills: d.requiresSkills ?? false,
        defaultSkillIds: d.defaultSkillIds ?? [],
        requiresMcp: d.requiresMcp ?? false,
        defaultMcpIds: d.defaultMcpIds ?? [],
        inputFields: shape.inputFields,
        outputSchema: shape.outputSchema,
      };
    }
    out["custom-ai"] = { ...(out["custom-ai"] ?? {}), customSteps };
    return out;
  }, [catalog, defs]);
}
