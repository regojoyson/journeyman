import type { OutputSchema } from "@journeyman/core";
import type { InputFields } from "../shared-meta.ts";

export const PLAN_PHASE_TYPE = "plan";
export const PLAN_LABEL = "Plan";
export const PLAN_CATEGORY = "AI";

export const planOutputSchema: OutputSchema = {
  steps:            { type: "json", description: "Ordered list of implementation steps" },
  estimatedMinutes: { type: "number" },
};

export const planInputFields: InputFields = {
  ticketKey:   { type: "string", label: "Ticket key", required: true },
  repoPath:    { type: "string", label: "Repo path", required: true },
  analysisRef: { type: "string", label: "Analysis ref" },
};
