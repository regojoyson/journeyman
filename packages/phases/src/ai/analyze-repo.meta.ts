import type { OutputSchema, InputFields } from "@journeyman/core";

export const ANALYZE_REPO_PHASE_TYPE = "analyze-repo";
export const ANALYZE_REPO_LABEL = "Analyze Repo";
export const ANALYZE_REPO_CATEGORY = "Coding Agent";
export const ANALYZE_REPO_DESCRIPTION =
  "Run a coding agent to analyze a repository against an issue and report a summary, complexity, and likely-affected files.";

export const analyzeRepoOutputSchema: OutputSchema = {
  summary:           { type: "string", description: "Plain-language change summary" },
  complexity:        { type: "string", description: "One of: low|medium|high" },
  affectedFiles:     { type: "array", items: { type: "string" }, description: "Areas/files likely to change" },
  analyzeReportPath: { type: "string", description: "Path to the markdown analyze report" },
};

export const analyzeRepoInputFields: InputFields = {
  repoDir:      { shape: { type: "string" }, label: "Repo directory", required: true },
  issueContent: { shape: { type: "string" }, label: "Issue content", required: true },
};
