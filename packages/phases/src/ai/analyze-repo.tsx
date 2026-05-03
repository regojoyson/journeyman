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

interface AnalyzeRepoConfig {
  repoDir: string;
  issueContent: string;
}

export const analyzeRepoPhase: PhaseDefinition<AnalyzeRepoConfig> = {
  phaseType: ANALYZE_REPO_PHASE_TYPE,
  label: ANALYZE_REPO_LABEL,
  category: ANALYZE_REPO_CATEGORY,
  description: ANALYZE_REPO_DESCRIPTION,
  color: "#00b894",
  icon: "🤖",
  defaultConfig: { repoDir: "", issueContent: "" },
  configSchema: z.object({
    repoDir: z.string().min(1, "repoDir is required"),
    issueContent: z.string().min(1, "issueContent is required"),
  }),
  configFields: {
    repoDir:       { label: "Repo directory",  widget: "text",     help: "Local path or workspace ref" },
    issueContent: { label: "Issue content",  widget: "textarea", help: "Markdown body of the issue" },
  },
  tabs: { io: "shown", mcp: "shown", retry: "shown" },
  slots: [
    {
      name: "ANTHROPIC_API_KEY",
      description: "Anthropic API key. Optional — falls back to the SDK's ambient credentials when unset.",
      optional: true,
    },
  ],
  summary: (c, ctx) => summaryValue(c, ctx, "repoDir") || "(no repo)",
  executor: { kind: "coding-cli", method: "analyze" },
  outputSchema: analyzeRepoOutputSchema,
};
