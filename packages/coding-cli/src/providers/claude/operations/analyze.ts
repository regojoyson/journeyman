import { query } from "@anthropic-ai/claude-agent-sdk";
import { createLogger, formatIssueForPrompt } from "@journeyman/core";
import { toMcpServerConfigs, mergeSystemPrompts } from "@journeyman/mcp/sdk-adapter";
import { logSdkMessage } from "../utils/sdk-logger.ts";
import { resolveSession } from "../utils/session.ts";
import type { AnalyzeOptions, AnalyzeResult } from "@journeyman/core";

const log = createLogger("claude:analyze");

export type { AnalyzeOptions, AnalyzeResult };

const EMPTY_RESULT: Omit<AnalyzeResult, "sessionId"> = {
  issueSummary: "",
  issueType: "other",
  codebaseSummary: "",
  affectedAreas: [],
  findings: [],
  assumptions: [],
  risks: [],
  recommendations: [],
  complexity: "medium",
  readinessScore: 0,
  reportTitle: "",
  reportPath: "",
  summary: "",
};

const OUTPUT_SCHEMA = {
  type: "object",
  properties: {
    issueSummary: { type: "string" },
    issueType: {
      type: "string",
      enum: ["bug", "feature", "enhancement", "task", "refactor", "other"],
    },
    codebaseSummary: { type: "string" },
    affectedAreas: { type: "array", items: { type: "string" } },
    findings: {
      type: "array",
      items: {
        type: "object",
        properties: {
          id: { type: "string" },
          category: {
            type: "string",
            enum: [
              "ambiguity",
              "inconsistency",
              "underspecified",
              "duplication",
              "risk",
              "terminology",
              "coverage-gap",
              "assumption",
            ],
          },
          severity: {
            type: "string",
            enum: ["critical", "high", "medium", "low", "info"],
          },
          title: { type: "string" },
          description: { type: "string" },
          location: { type: "string" },
          recommendation: { type: "string" },
        },
        required: ["id", "category", "severity", "title", "description"],
      },
    },
    assumptions: { type: "array", items: { type: "string" } },
    risks: { type: "array", items: { type: "string" } },
    recommendations: { type: "array", items: { type: "string" } },
    complexity: {
      type: "string",
      enum: ["trivial", "low", "medium", "high", "very-high"],
    },
    readinessScore: { type: "number", minimum: 0, maximum: 100 },
    reportTitle: { type: "string" },
    reportPath: { type: "string" },
    summary: { type: "string" },
    error: { type: "string" },
  },
  required: [
    "issueSummary",
    "issueType",
    "codebaseSummary",
    "affectedAreas",
    "findings",
    "assumptions",
    "risks",
    "recommendations",
    "complexity",
    "readinessScore",
    "reportTitle",
    "reportPath",
    "summary",
  ],
} as const;

function buildPrompt(opts: AnalyzeOptions): string {
  const issue = opts.issue ? formatIssueForPrompt(opts.issue) : "(no issue provided — infer intent from workspace contents)";
  const focus = opts.focus?.trim();
  const docsDir = `${opts.workspaceDir.replace(/\/+$/, "")}/docs/analyze`;
  const reviewBlock = opts.reviewComments
    ? `\n\n## Reviewer feedback (incorporate into the revised analysis)\n\n${opts.reviewComments}\n`
    : "";

  return [
    "You are a senior staff engineer performing a speckit-style analysis of a issue against a codebase.",
    "",
    "=== AUTONOMY RULES (non-negotiable) ===",
    "  1. This run is FULLY AUTONOMOUS. There is no human on the other end. Nobody will answer you.",
    "  2. NEVER ask clarifying questions — not in text, not via tools. Questions will not be read.",
    "  3. When information is missing or ambiguous, DECIDE. Pick the most reasonable interpretation based on the issue + codebase + industry standards, proceed, and record the decision in `assumptions`.",
    "  4. Prefer the BEST approach on the merits, not the 'safest' approach that defers the decision.",
    "  5. Do not stall, loop, or abandon the task. Always produce a complete report — even a partial analysis is better than no output.",
    "  6. Never output prose asking for confirmation, approval, or next steps. The only output is the final JSON report.",
    `${reviewBlock}`,
    "=== TICKET ===",
    issue,
    "",
    "=== WORKSPACE ===",
    `Workspace root: ${opts.workspaceDir}`,
    "(may contain one or more cloned repos as subdirectories — locate the relevant one(s) from the issue)",
    focus ? `Focus area: ${focus}` : "Focus: whole codebase relevant to the issue.",
    "",
    "=== INVESTIGATION STEPS (use Bash / Read / Grep / Glob) ===",
    `  1. ls ${opts.workspaceDir} and inspect top-level structure`,
    "  2. Read README / package.json / pyproject / go.mod etc. to understand the project",
    "  3. grep for keywords from the issue (feature names, symbols, identifiers) to locate affected modules",
    "  4. Read the most relevant files (entrypoints, modules matching the issue scope)",
    "  5. Cross-reference the issue requirements against what the code currently does",
    "",
    "=== WRITE THE REPORT TO DISK ===",
    `  1. Ensure the docs directory exists: mkdir -p ${docsDir}`,
    "  2. Derive a slug from the issue key/title (kebab-case, lowercase, alnum+dashes).",
    `  3. Write a markdown report to: ${docsDir}/<slug>-<YYYYMMDD-HHmm>.md`,
    "     Use a heredoc or the file tool. The markdown MUST contain sections:",
    "       # <Report Title>",
    "       ## Issue Summary, ## Issue Type, ## Codebase Summary,",
    "       ## Affected Areas, ## Findings (table: id | category | severity | title | location),",
    "       ## Assumptions, ## Risks, ## Recommendations,",
    "       ## Complexity, ## Readiness Score.",
    "  4. Verify the file exists with `ls -l` before returning.",
    "",
    "=== REPORT REQUIREMENTS (speckit-style) ===",
    "Return a structured JSON report with these fields:",
    "  - issueSummary: 1-3 sentence plain-language summary of what the issue asks for.",
    "  - issueType: bug | feature | enhancement | task | refactor | other.",
    "  - codebaseSummary: what the relevant parts of the codebase currently do.",
    "  - affectedAreas: list of file paths / modules / components that would be touched.",
    "  - findings: array — each { id (F-001 style), category, severity, title, description, location?, recommendation? }.",
    "    categories: ambiguity | inconsistency | underspecified | duplication | risk | terminology | coverage-gap | assumption.",
    "    severity: critical | high | medium | low | info.",
    "  - assumptions: assumptions you had to make because the issue was underspecified.",
    "  - risks: things that could go wrong during implementation (regressions, data loss, perf, security).",
    "  - recommendations: concrete next steps, ordered by priority.",
    "  - complexity: trivial | low | medium | high | very-high.",
    "  - readinessScore: 0-100. 100 = crystal clear; 0 = unworkable without clarification.",
    "  - reportTitle: short human title for the report, e.g. 'Analysis: <issue key> — <short phrase>'.",
    "    Suitable for posting as a issue comment heading.",
    "  - reportPath: absolute path of the markdown file you just wrote.",
    "  - summary: a concise issue-comment-ready summary (markdown, 4-8 short lines or bullets).",
    "    Must include: 1-line TL;DR, issue type, complexity, readiness score, top 3 findings by severity,",
    "    and a pointer line 'Full report: <reportPath>'. Written so a PM/engineer can skim and act.",
    "",
    "Return ONLY the JSON matching the schema. No prose outside of it.",
  ].join("\n");
}

/**
 * Autonomously analyzes a issue against a codebase and returns a
 * speckit-style structured report: issue classification, affected areas,
 * findings (with severity), assumptions, risks, recommendations, complexity,
 * and a readiness score. No human-in-the-loop — the agent makes reasonable
 * assumptions and records them.
 *
 * @param opts - workspaceDir (codebase root), issue (full Issue object from a tracker),
 *   optional focus to narrow scope.
 * @returns A structured AnalyzeResult.
 *
 * @example
 * ```ts
 * const report = await analyze({
 *   workspaceDir: "/projects/api",
 *   issue: { id: "PROJ-123", title: "Add rate limiting to /users endpoint", description: "..." },
 * });
 * ```
 */
export async function analyze(opts: AnalyzeOptions): Promise<AnalyzeResult> {
  const { sessionId, queryOption } = resolveSession(opts.sessionId);
  log.info({ sessionId, workspaceDir: opts.workspaceDir, focus: opts.focus }, "analyze start");
  const controller = opts.signal
    ? (() => {
        const ac = new AbortController();
        if (opts.signal!.aborted) ac.abort(opts.signal!.reason);
        else opts.signal!.addEventListener("abort", () => ac.abort(opts.signal!.reason), { once: true });
        return ac;
      })()
    : undefined;
  const mcpServers = opts.mcps?.length ? toMcpServerConfigs(opts.mcps) : undefined;
  const mcpPromptSuffix = opts.mcps?.length ? mergeSystemPrompts(opts.mcps) : "";
  const mcpKeys = mcpServers ? Object.keys(mcpServers) : [];
  const mcpToolNames = mcpKeys.map((k) => `mcp__${k}`);
  let output: AnalyzeResult = { ...EMPTY_RESULT, sessionId };

  for await (const msg of query({
    prompt: mcpPromptSuffix ? `${buildPrompt(opts)}\n\n${mcpPromptSuffix}` : buildPrompt(opts),
    options: {
      tools: ["Bash", "Read", "Glob", "Grep", "Write", ...mcpToolNames],
      allowedTools: ["Bash", "Read", "Glob", "Grep", "Write", ...mcpToolNames],
      permissionMode: "bypassPermissions",
      allowDangerouslySkipPermissions: true,
      maxTurns: 40,
      settingSources: [],
      settings: { allowedMcpServers: mcpKeys.map((k) => ({ serverName: k })) },
      ...(mcpServers ? { mcpServers } : {}),
      outputFormat: { type: "json_schema", schema: OUTPUT_SCHEMA },
      ...(opts.model ? { model: opts.model } : {}),
      ...(controller !== undefined ? { abortController: controller } : {}),
      ...queryOption,
    },
  })) {
    logSdkMessage(msg);
    if (msg.type === "result") {
      if (msg.subtype !== "success") {
        const error = (msg as any).errors?.[0] ?? msg.subtype;
        log.error({ sessionId, error }, "analyze failed");
        return { ...EMPTY_RESULT, sessionId, error };
      }
      output = { ...(msg.structured_output as AnalyzeResult), sessionId };
    }
  }

  log.info(
    {
      sessionId,
      issueType: output.issueType,
      complexity: output.complexity,
      readinessScore: output.readinessScore,
      findingCount: output.findings.length,
      reportPath: output.reportPath,
    },
    "analyze done",
  );
  return output;
}

// Run: npx tsx analyze.ts
if (import.meta.url === `file://${process.argv[1]}`) {
  const result = await analyze({
    workspaceDir: "/Users/admin/data/workspace/claude-skils/journeyman",
    issue: {
      id: "JM-42",
      title: "Add `dry-run` flag to checkoutRepo",
      description:
        "Add a `dry-run` flag to checkoutRepo so callers can preview the git commands that would run without actually executing them. Must log the planned commands per repo and return success=true with a new `planned` array.",
    },
  });
  process.stdout.write(JSON.stringify(result, null, 2) + "\n");
}
