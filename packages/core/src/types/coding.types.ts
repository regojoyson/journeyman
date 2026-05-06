import type { SessionOptions, SessionResult } from "./session.types.ts";
import type { Issue } from "./issue.types.ts";
import type { ResolvedMcpInstance } from "./mcp.types.ts";
import type { ResolvedSkillPackage } from "./skills.types.ts";
import type { CanonicalTool } from "./coding-tools.types.ts";

// ---------------------------------------------------------------------------
// Provider config — shared across all coding-CLI providers
// ---------------------------------------------------------------------------

export type CodingCLIPhase =
  | "scanRepos"
  | "checkoutRepo"
  | "commitPushRepos"
  | "cleanupRepos"
  | "createWorkspace"
  | "analyze"
  | "plan"
  | "implement"
  | "runCustomPrompt";

export interface CodingCLIProviderConfig {
  /** Fallback model for any phase not listed in `models`. */
  defaultModel?: string;
  /** Per-phase model overrides. Takes precedence over defaultModel. */
  models?: Partial<Record<CodingCLIPhase, string>>;
  /** Optional API key. When unset, the SDK uses its ambient credentials (env). */
  apiKey?: string;
}

export type AnalyzeOptions = SessionOptions & {
  /** Workspace root containing one or more cloned repos. The agent explores this tree. */
  workspaceDir: string;
  /** Optional — full issue object. Serialised into the prompt by the operation. */
  issue?: Issue;
  focus?: string;
  /** Optional — reviewer feedback (markdown) to incorporate into analysis. */
  reviewComments?: string;
  signal?: AbortSignal;
  model?: string;
  /** Resolved MCP instances to attach to the SDK query. Empty/undefined ⇒ no MCPs. */
  mcps?: ResolvedMcpInstance[];
  /** Resolved skill packages to load as plugins for the SDK query. */
  skills?: ResolvedSkillPackage[];
};

export type AnalyzeIssueType = "bug" | "feature" | "enhancement" | "task" | "refactor" | "other";
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
  issueSummary: string;
  issueType: AnalyzeIssueType;
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
  /** Workspace root containing one or more cloned repos. */
  workspaceDir: string;
  /** Optional — full issue object. If omitted, the plan is derived purely from the analyze report. */
  issue?: Issue;
  /** Optional — explicit path to a prior analyze report (markdown). If omitted, the latest report in docs/analyze is used. */
  analyzeReportPath?: string;
  /** Optional narrowing of scope. */
  focus?: string;
  /** Optional — reviewer feedback (markdown) to incorporate into the plan. */
  reviewComments?: string;
  signal?: AbortSignal;
  model?: string;
  /** Resolved MCP instances to attach to the SDK query. Empty/undefined ⇒ no MCPs. */
  mcps?: ResolvedMcpInstance[];
  /** Resolved skill packages to load as plugins for the SDK query. */
  skills?: ResolvedSkillPackage[];
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
  /** Workspace root containing one or more cloned repos. */
  workspaceDir: string;
  /** Optional — full issue object. */
  issue?: Issue;
  /** Optional — explicit path to a prior analyze report (markdown). If omitted, the latest file in docs/analyze is used. */
  analyzeReportPath?: string;
  /** Optional — explicit path to a prior plan report (markdown). If omitted, the latest file in docs/plan is used. */
  planReportPath?: string;
  /** Optional — additional rules / constraints layered on top of the defaults. */
  extraRules?: string[];
  /** Optional narrowing of scope. */
  focus?: string;
  /** Optional — reviewer feedback (markdown) to incorporate during implementation. */
  reviewComments?: string;
  signal?: AbortSignal;
  model?: string;
  /** Resolved MCP instances to attach to the SDK query. Empty/undefined ⇒ no MCPs. */
  mcps?: ResolvedMcpInstance[];
  /** Resolved skill packages to load as plugins for the SDK query. */
  skills?: ResolvedSkillPackage[];
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

// ---------------------------------------------------------------------------
// Custom AI phase — generic prompt runner
// ---------------------------------------------------------------------------

export interface RunCustomPromptOptions {
  prompt: string;
  outputMode: "none" | "text" | "structured";
  outputSchema?: Record<string, unknown>;
  cwd?: string;
  mcps?: ResolvedMcpInstance[];
  skills?: ResolvedSkillPackage[];
  /**
   * Canonical Journeyman tool names. Each provider translates to its native
   * tool names. Empty/undefined means a pure-prompt phase (no tools).
   */
  tools?: CanonicalTool[];
  sessionId?: string;
  signal?: AbortSignal;
  model?: string;
}

export interface RunCustomPromptResult {
  result?: string;
  structured?: unknown;
  error?: string;
  sessionId?: string;
}
