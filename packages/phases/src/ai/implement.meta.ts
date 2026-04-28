import type { OutputSchema } from "@journeyman/core";
import type { InputFields } from "../shared-meta.ts";

export const IMPLEMENT_PHASE_TYPE = "implement";
export const IMPLEMENT_LABEL = "Implement";
export const IMPLEMENT_CATEGORY = "AI";

export const implementOutputSchema: OutputSchema = {
  filesChanged: { type: "string[]" },
  diffSummary:  { type: "string" },
};

export const implementInputFields: InputFields = {
  planRef:  { type: "string", label: "Plan ref", required: true },
  repoPath: { type: "string", label: "Repo path", required: true },
};
