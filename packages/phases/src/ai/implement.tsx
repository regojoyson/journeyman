// packages/phases/src/ai/implement.tsx
import { z } from "zod";
import type { PhaseDefinition } from "@journeyman/flow-editor";
import { IMPLEMENT_PHASE_TYPE, IMPLEMENT_LABEL, IMPLEMENT_CATEGORY, implementOutputSchema } from "./implement.meta.ts";

interface ImplementConfig {
  planRef: string;
  repoPath: string;
}

export const implementPhase: PhaseDefinition<ImplementConfig> = {
  phaseType: IMPLEMENT_PHASE_TYPE,
  label: IMPLEMENT_LABEL,
  category: IMPLEMENT_CATEGORY,
  description: "Execute a plan against a repo using a coding-cli provider.",
  color: "#6c5ce7",
  icon: "🛠",
  defaultConfig: { planRef: "", repoPath: "" },
  configSchema: z.object({
    planRef: z.string().min(1),
    repoPath: z.string().min(1),
  }),
  configFields: {
    planRef:  { label: "Plan ref", widget: "text", help: "Reference to a plan-phase output" },
    repoPath: { label: "Repo path", widget: "text" },
  },
  tabs: { io: "shown", credentials: "required", mcp: "shown", retry: "shown" },
  summary: c => c.planRef || "(no plan)",
  executor: { kind: "coding-cli", method: "implement" },
  outputSchema: implementOutputSchema,
};
