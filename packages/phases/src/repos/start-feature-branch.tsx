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
  // no static config needed; repos and issue come from bindings at runtime
}

export const startFeatureBranchPhase: PhaseDefinition<StartFeatureBranchConfig> = {
  phaseType: START_FEATURE_BRANCH_PHASE_TYPE,
  label: START_FEATURE_BRANCH_LABEL,
  category: START_FEATURE_BRANCH_CATEGORY,
  description: START_FEATURE_BRANCH_DESCRIPTION,
  color: "#fdcb6e",
  icon: "⬇",
  defaultConfig: {},
  configSchema: z.object({}),
  configFields: {},
  tabs: { io: "shown", requiredSecrets: "shown", mcp: "hidden", retry: "shown" },
  slots: [
    {
      name: "GITHUB_ACCESS_TOKEN",
      description: "GitHub PAT used by `git push` / `git fetch` against origin.",
    },
  ],
  summary: () => "sync + branch",
  executor: { kind: "coding-cli", method: "checkoutRepo" },
  outputSchema: startFeatureBranchOutputSchema,
};
