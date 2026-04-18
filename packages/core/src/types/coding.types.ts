import type { SessionOptions, SessionResult } from "./session.types.ts";

export type AnalyzeOptions = SessionOptions & {
  dirPath: string;
  ticketContent?: string;
  focus?: string;
  signal?: AbortSignal;
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
  /** Optional — ticket / goal text. If omitted, the plan is derived purely from the analyze report. */
  ticketContent?: string;
  /** Optional — explicit path to a prior analyze report (markdown). If omitted, the latest report in docs/analyze is used. */
  analyzeReportPath?: string;
  /** Optional narrowing of scope. */
  focus?: string;
  signal?: AbortSignal;
};

export type PlanStepKind =
  | "setup"
  | "code-change"
  | "refactor"
  | "test"
  | "config"
  | "migration"
  | "docs"
  | "verification"
  | "rollout";

export type PlanStep = {
  id: string;
  kind: PlanStepKind;
  title: string;
  description: string;
  files?: string[];
  commands?: string[];
  acceptanceCriteria?: string[];
  dependsOn?: string[];
};

export type PlanResult = SessionResult & {
  planTitle: string;
  goal: string;
  approachSummary: string;
  affectedFiles: string[];
  steps: PlanStep[];
  testStrategy: string[];
  rolloutNotes: string[];
  risks: string[];
  openQuestions: string[];
  estimatedComplexity: AnalyzeComplexity;
  reportTitle: string;
  reportPath: string;
  summary: string;
  error?: string;
};

export type ImplementOptions = SessionOptions & {
  dirPath: string;
  /** Optional — ticket / goal text. */
  ticketContent?: string;
  /** Optional — explicit path to a prior analyze report (markdown). If omitted, the latest file in docs/analyze is used. */
  analyzeReportPath?: string;
  /** Optional — explicit path to a prior plan report (markdown). If omitted, the latest file in docs/plan is used. */
  planReportPath?: string;
  /** Optional — additional rules / constraints layered on top of the defaults. */
  extraRules?: string[];
  /** Optional narrowing of scope. */
  focus?: string;
  signal?: AbortSignal;
};

export type ImplementChangeKind = "created" | "modified" | "deleted";

export type ImplementFileChange = {
  path: string;
  kind: ImplementChangeKind;
  summary: string;
};

export type ImplementStepResult = {
  id: string;
  title: string;
  status: "done" | "skipped" | "partial" | "failed";
  notes?: string;
};

export type ImplementResult = SessionResult & {
  success: boolean;
  implementationTitle: string;
  approachSummary: string;
  filesChanged: ImplementFileChange[];
  steps: ImplementStepResult[];
  testsRun: string[];
  testsPassed: boolean;
  followUps: string[];
  reportTitle: string;
  reportPath: string;
  summary: string;
  error?: string;
};
