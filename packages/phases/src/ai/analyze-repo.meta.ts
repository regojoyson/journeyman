import type { OutputSchema } from "@journeyman/core";
import type { InputFields } from "../shared-meta.ts";

export const ANALYZE_REPO_PHASE_TYPE = "analyze-repo";
export const ANALYZE_REPO_LABEL = "Analyze Repo";
export const ANALYZE_REPO_CATEGORY = "Coding Agent";
export const ANALYZE_REPO_DESCRIPTION =
  "Run a coding agent to analyze a repository against a ticket and report a summary, complexity, and likely-affected files.";

export const analyzeRepoOutputSchema: OutputSchema = {
  summary:       { type: "string", description: "Plain-language change summary" },
  complexity:    { type: "enum", values: ["low", "medium", "high"] },
  affectedFiles: { type: "string[]", description: "Files likely to change" },
};

export const analyzeRepoInputFields: InputFields = {
  dirPath:       { type: "string", label: "Repo path", required: true },
  ticketContent: { type: "string", label: "Ticket content", required: true },
};
