import { z } from "zod";
import type { PhaseDefinition } from "@journeyman/flow-editor";
import { summaryValue } from "@journeyman/flow-editor";
import {
  ANALYZE_REPO_PHASE_TYPE,
  ANALYZE_REPO_LABEL,
  ANALYZE_REPO_CATEGORY,
  ANALYZE_REPO_DESCRIPTION,
  analyzeRepoOutputSchema,
} from "./analyze-repo.meta.ts";

type AnalyzeRepoConfig = Record<string, never>;

export const analyzeRepoPhase: PhaseDefinition<AnalyzeRepoConfig> = {
  phaseType: ANALYZE_REPO_PHASE_TYPE,
  label: ANALYZE_REPO_LABEL,
  category: ANALYZE_REPO_CATEGORY,
  description: ANALYZE_REPO_DESCRIPTION,
  color: "#00b894",
  icon: "🤖",
  defaultConfig: {},
  configSchema: z.object({}),
  configFields: {},
  tabs: { io: "shown", mcp: "shown", skills: "shown", retry: "shown" },
  supportsSkills: true,
  supportsModelSelection: true,
  slots: [
    {
      name: "ANTHROPIC_API_KEY",
      description: "Anthropic API key. Optional — falls back to the SDK's ambient credentials when unset.",
      optional: true,
    },
  ],
  summary: (c, ctx) => summaryValue(c, ctx, "workspaceDir") || "(no workspace)",
  executor: { kind: "coding-cli", method: "analyze" },
  outputSchema: analyzeRepoOutputSchema,
};
