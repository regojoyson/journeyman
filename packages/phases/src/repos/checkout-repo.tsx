// packages/phases/src/repos/checkout-repo.tsx
import { z } from "zod";
import type { PhaseDefinition } from "@journeyman/flow-editor";

interface CheckoutRepoConfig {
  url: string;
  branch?: string;
  targetDir: string;
}

export const checkoutRepoPhase: PhaseDefinition<CheckoutRepoConfig> = {
  phaseType: "checkout-repo",
  label: "Checkout Repo",
  category: "Repos",
  description: "Clone or update a repository to a target directory.",
  color: "#fdcb6e",
  icon: "⬇",
  defaultConfig: { url: "", branch: "", targetDir: "" },
  configSchema: z.object({
    url: z.string().min(1),
    branch: z.string().optional(),
    targetDir: z.string().min(1),
  }),
  configFields: {
    url:       { label: "Repo URL",   widget: "text" },
    branch:    { label: "Branch",     widget: "text", help: "Defaults to repo default branch" },
    targetDir: { label: "Target dir", widget: "text" },
  },
  tabs: { io: "shown", credentials: "hidden", mcp: "hidden", retry: "shown" },
  summary: c => c.branch ? `${c.url}@${c.branch}` : c.url,
  executor: { kind: "coding-cli", method: "checkoutRepo" },
};
