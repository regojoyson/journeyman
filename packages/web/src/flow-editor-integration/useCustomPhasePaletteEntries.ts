import { useEffect, useState } from "react";
import type { CustomAiPhase, OutputSchema } from "@journeyman/core";
import type { PhaseDefinition } from "@journeyman/flow-editor";

const colors = ["#a29bfe", "#fd79a8", "#55efc4", "#ffeaa7", "#74b9ff", "#fab1a0"];

/**
 * Synthesizes one palette `PhaseDefinition` per visible custom phase.
 *
 * Each entry uses a unique `phaseType: "custom-ai:<uuid>"` so the palette
 * shows them as distinct items. The Canvas drop handler strips that prefix
 * back to the bare "custom-ai" runtime phase type. The `customPhaseId` is
 * baked into `defaultConfig` so the orchestrator can load the right
 * definition at run time.
 */
export function useCustomPhasePaletteEntries(orgId: string): PhaseDefinition<any>[] {
  const [defs, setDefs] = useState<PhaseDefinition<any>[]>([]);

  useEffect(() => {
    if (!orgId) return;
    let alive = true;
    fetch(`/api/orgs/${orgId}/custom-phases/visible`, { credentials: "include" })
      .then((r) => (r.ok ? r.json() : Promise.reject(r)))
      .then((rows: CustomAiPhase[]) => {
        if (!alive) return;
        setDefs(rows.map((p, i) => buildSyntheticPhase(p, colors[i % colors.length])));
      })
      .catch(() => { if (alive) setDefs([]); });
    return () => { alive = false; };
  }, [orgId]);

  return defs;
}

function buildSyntheticPhase(p: CustomAiPhase, color: string): PhaseDefinition<any> {
  return {
    phaseType: `custom-ai:${p.id}`,
    label: p.name,
    category: p.scope === "org" ? "Custom (Org)" : "Custom",
    description: p.description || `Custom AI phase: ${p.name}`,
    color,
    icon: "🧩",
    defaultConfig: {
      customPhaseId: p.id,
      mcpInstanceIds: p.defaultMcpIds ?? [],
      skillIds: p.defaultSkillIds ?? [],
    },
    configFields: {},
    tabs: { io: "shown", mcp: "shown", skills: "shown", retry: "shown" },
    supportsSkills: true,
    slots: [
      { name: "ANTHROPIC_API_KEY", description: "Anthropic API key. Optional.", optional: true },
    ],
    summary: () => p.name,
    executor: { kind: "coding-cli", method: "runCustomPrompt" },
    outputSchema: outputSchemaFor(p),
  };
}

function outputSchemaFor(p: CustomAiPhase): OutputSchema {
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
