// packages/phases/src/repos/scan-repos.tsx
import { z } from "zod";
import type { PhaseDefinition } from "@journeyman/flow-editor";
import {
  SCAN_REPOS_PHASE_TYPE,
  SCAN_REPOS_LABEL,
  SCAN_REPOS_CATEGORY,
  scanReposOutputSchema,
} from "./scan-repos.meta.ts";

interface ScanReposConfig {
  pattern: string;
}

export const scanReposPhase: PhaseDefinition<ScanReposConfig> = {
  phaseType: SCAN_REPOS_PHASE_TYPE,
  label: SCAN_REPOS_LABEL,
  category: SCAN_REPOS_CATEGORY,
  description: "Scan a workspace for repositories matching a pattern.",
  color: "#fdcb6e",
  icon: "🔍",
  defaultConfig: { pattern: "*" },
  configSchema: z.object({
    pattern: z.string().min(1),
  }),
  configFields: {
    pattern:      { label: "Glob pattern",  widget: "text", help: "e.g. */api-*" },
  },
  tabs: { io: "shown", credentials: "hidden", mcp: "hidden", retry: "shown" },
  summary: c => c.pattern,
  executor: { kind: "coding-cli", method: "scanRepos" },
  outputSchema: scanReposOutputSchema,
};
