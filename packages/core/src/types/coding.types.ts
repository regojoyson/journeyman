import type { SessionOptions, SessionResult } from "./session.types.ts";

export type AnalyzeOptions = SessionOptions & {
  dirPath: string;
  ticketContent?: string;
  focus?: string;
};

export type AnalyzeTicketType = "bug" | "feature" | "enhancement" | "task" | "refactor" | "other";
export type AnalyzeSeverity = "critical" | "high" | "medium" | "low" | "info";
export type AnalyzeComplexity = "trivial" | "low" | "medium" | "high" | "very-high";
export type AnalyzeFindingCategory =
  | "ambiguity"
  | "inconsistency"
  | "underspecified"
  | "duplication"
  | "risk"
  | "terminology"
  | "coverage-gap"
  | "assumption";

export type AnalyzeFinding = {
  id: string;
  category: AnalyzeFindingCategory;
  severity: AnalyzeSeverity;
  title: string;
  description: string;
  location?: string;
  recommendation?: string;
};

export type AnalyzeResult = SessionResult & {
  ticketSummary: string;
  ticketType: AnalyzeTicketType;
  codebaseSummary: string;
  affectedAreas: string[];
  findings: AnalyzeFinding[];
  assumptions: string[];
  risks: string[];
  recommendations: string[];
  complexity: AnalyzeComplexity;
  readinessScore: number;
  reportTitle: string;
  reportPath: string;
  summary: string;
  error?: string;
};

export type PlanOptions = SessionOptions & {
  dirPath: string;
  goal: string;
  context?: string;
};

export type PlanResult = SessionResult & {
  steps: string[];
  error?: string;
};

export type ImplementOptions = SessionOptions & {
  dirPath: string;
  plan: string;
  branch: string;
};

export type ImplementResult = SessionResult & {
  success: boolean;
  filesChanged?: string[];
  error?: string;
};
