import type { PhaseDefinition } from "@journeyman/flow-editor";
import {
  START_FEATURE_BRANCH_PHASE_TYPE,
  START_FEATURE_BRANCH_LABEL,
  START_FEATURE_BRANCH_CATEGORY,
  START_FEATURE_BRANCH_DESCRIPTION,
  startFeatureBranchOutputSchema,
  startFeatureBranchConfigSchema,
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
  configSchema: startFeatureBranchConfigSchema,
  configFields: {},
  // No secret slots — git auth is reused from the embedded credential in the
  // already-cloned repo's `.git/config` (set by clone-repos). Hide the tab to
  // avoid confusing users.
  tabs: { io: "shown", requiredSecrets: "hidden", mcp: "hidden", retry: "shown" },
  slots: [],
  summary: () => "sync + branch",
  executor: { kind: "coding-cli", method: "checkoutRepo" },
  outputSchema: startFeatureBranchOutputSchema,
};
