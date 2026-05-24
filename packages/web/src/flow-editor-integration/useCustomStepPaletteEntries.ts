import { useEffect, useState } from "react";
import type { CustomAiStep, OutputSchema } from "@journeyman/core";
import { DEFAULT_CUSTOM_STEP_ICON_ID } from "@journeyman/core";
import type { StepDefinition } from "@journeyman/flow-editor";

const colors = ["#a29bfe", "#fd79a8", "#55efc4", "#ffeaa7", "#74b9ff", "#fab1a0"];

/**
 * Synthesizes one palette `StepDefinition` per visible custom step.
 *
 * Each entry uses a unique `stepType: "custom-ai:<uuid>"` so the palette
 * shows them as distinct items. The Canvas drop handler strips that prefix
 * back to the bare "custom-ai" runtime step type. The `customStepId` is
 * baked into `defaultConfig` so the orchestrator can load the right
 * definition at run time.
 */
export function useCustomStepPaletteEntries(orgId: string): StepDefinition<any>[] {
  const [defs, setDefs] = useState<StepDefinition<any>[]>([]);

  useEffect(() => {
    if (!orgId) return;
    let alive = true;
    fetch(`/api/orgs/${orgId}/custom-steps/visible`, { credentials: "include" })
      .then((r) => (r.ok ? r.json() : Promise.reject(r)))
      .then((rows: CustomAiStep[]) => {
        if (!alive) return;
        setDefs(rows.map((p, i) => buildSyntheticStep(p, colors[i % colors.length])));
      })
      .catch(() => { if (alive) setDefs([]); });
    return () => { alive = false; };
  }, [orgId]);

  return defs;
}

function buildSyntheticStep(p: CustomAiStep, color: string): StepDefinition<any> {
  return {
    stepType: `custom-ai:${p.id}`,
    label: p.name,
    category: p.scope === "org" ? "Custom (Org)" : "Custom",
    description: p.description || `Custom AI step: ${p.name}`,
    color,
    icon: p.icon ?? DEFAULT_CUSTOM_STEP_ICON_ID,
    defaultConfig: {
      customStepId: p.id,
      mcpInstanceIds: p.defaultMcpIds ?? [],
      skillIds: p.defaultSkillIds ?? [],
    },
    configFields: {},
    tabs: { io: "shown", mcp: "shown", skills: "shown", retry: "shown" },
    supportsSkills: true,
    slots: [],
    summary: () => p.name,
    executor: { kind: "coding-cli", method: "runCustomPrompt" },
    outputSchema: outputSchemaFor(p),
  };
}

function outputSchemaFor(p: CustomAiStep): OutputSchema {
  if (p.outputMode === "text") {
    return { result: { type: "string" } } as OutputSchema;
  }
  if (p.outputMode === "structured" && p.outputSchema) {
    const props = (p.outputSchema as any).properties ?? {};
    return Object.fromEntries(
      Object.entries(props).map(([k, v]: [string, any]) => [
        k,
        { type: (v?.type ?? "string"), ...(v?.description ? { description: v.description } : {}) },
      ]),
    ) as OutputSchema;
  }
  return {} as OutputSchema;
}
