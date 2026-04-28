// packages/phases/src/repos/scan-repos.tsx
import { z } from "zod";
import type { PhaseDefinition } from "@journeyman/flow-editor";

interface ScanReposConfig {
  workspaceDir: string;
  pattern: string;
}

export const scanReposPhase: PhaseDefinition<ScanReposConfig> = {
  phaseType: "scan-repos",
  label: "Scan Repos",
  category: "Repos",
  description: "Scan a workspace for repositories matching a pattern.",
  color: "#fdcb6e",
  icon: "🔍",
  defaultConfig: { workspaceDir: "", pattern: "*" },
  configSchema: z.object({
    workspaceDir: z.string().min(1),
    pattern: z.string().min(1),
  }),
  configFields: {
    workspaceDir: { label: "Workspace dir", widget: "text" },
    pattern:      { label: "Glob pattern",  widget: "text", help: "e.g. */api-*" },
  },
  tabs: { io: "shown", credentials: "hidden", mcp: "hidden", retry: "shown" },
  summary: c => c.pattern || c.workspaceDir,
  executor: { kind: "coding-cli", method: "scanRepos" },
};
