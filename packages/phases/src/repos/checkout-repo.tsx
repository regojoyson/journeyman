// packages/phases/src/repos/checkout-repo.tsx
import { z } from "zod";
import type { PhaseDefinition } from "@journeyman/flow-editor";
import {
  CHECKOUT_REPO_PHASE_TYPE,
  CHECKOUT_REPO_LABEL,
  CHECKOUT_REPO_CATEGORY,
  checkoutRepoOutputSchema,
} from "./checkout-repo.meta.ts";

interface CheckoutRepoConfig {
  url: string;
  branch?: string;
}

export const checkoutRepoPhase: PhaseDefinition<CheckoutRepoConfig> = {
  phaseType: CHECKOUT_REPO_PHASE_TYPE,
  label: CHECKOUT_REPO_LABEL,
  category: CHECKOUT_REPO_CATEGORY,
  description: "Clone or update a repository to a target directory.",
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
  tabs: { io: "shown", credentials: "hidden", mcp: "hidden", retry: "shown" },
  summary: c => c.branch ? `${c.url}@${c.branch}` : c.url,
  executor: { kind: "coding-cli", method: "checkoutRepo" },
  outputSchema: checkoutRepoOutputSchema,
};
