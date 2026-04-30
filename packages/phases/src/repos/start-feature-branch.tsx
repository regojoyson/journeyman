import { z } from "zod";
import type { PhaseDefinition } from "@journeyman/flow-editor";
import {
  START_FEATURE_BRANCH_PHASE_TYPE,
  START_FEATURE_BRANCH_LABEL,
  START_FEATURE_BRANCH_CATEGORY,
  START_FEATURE_BRANCH_DESCRIPTION,
  startFeatureBranchOutputSchema,
} from "./start-feature-branch.meta.ts";

interface StartFeatureBranchConfig {
  url: string;
  branch?: string;
}

export const startFeatureBranchPhase: PhaseDefinition<StartFeatureBranchConfig> = {
  phaseType: START_FEATURE_BRANCH_PHASE_TYPE,
  label: START_FEATURE_BRANCH_LABEL,
  category: START_FEATURE_BRANCH_CATEGORY,
  description: START_FEATURE_BRANCH_DESCRIPTION,
  color: "#fdcb6e",
  icon: "⬇",
  defaultConfig: { url: "", branch: "" },
  configSchema: z.object({
    url: z.string().min(1),
    branch: z.string().optional(),
  }),
  configFields: {
    url:       { label: "Repo URL",   widget: "text" },
    branch:    { label: "Branch",     widget: "text", help: "Defaults to repo default branch" },
  },
  tabs: { io: "shown", credentials: "hidden", requiredSecrets: "shown", mcp: "hidden", retry: "shown" },
  defaultRequiredSecrets: ["GITHUB_ACCESS_TOKEN"],
  summary: c => c.branch ? `${c.url}@${c.branch}` : c.url,
  executor: { kind: "coding-cli", method: "checkoutRepo" },
  outputSchema: startFeatureBranchOutputSchema,
};
