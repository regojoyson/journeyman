import { query } from "@anthropic-ai/claude-agent-sdk";
import { createLogger } from "@journeyman/core";
import { logSdkMessage } from "../utils/sdk-logger.ts";
import { resolveSession } from "../utils/session.ts";
import type { AnalyzeOptions, AnalyzeResult } from "@journeyman/core";

const log = createLogger("claude:analyze");

export type { AnalyzeOptions, AnalyzeResult };

const EMPTY_RESULT: Omit<AnalyzeResult, "sessionId"> = {
  ticketSummary: "",
  ticketType: "other",
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
    ticketSummary: { type: "string" },
    ticketType: {
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
    "ticketSummary",
    "ticketType",
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
  const ticket = opts.ticketContent?.trim() || "(no ticket content provided — infer intent from dirPath)";
  const focus = opts.focus?.trim();
  const docsDir = `${opts.dirPath.replace(/\/+$/, "")}/docs/analyze`;

  return [
    "You are a senior staff engineer performing a speckit-style analysis of a ticket against a codebase.",
    "",
    "=== AUTONOMY RULES (non-negotiable) ===",
    "  1. This run is FULLY AUTONOMOUS. There is no human on the other end. Nobody will answer you.",
    "  2. NEVER ask clarifying questions — not in text, not via tools. Questions will not be read.",
    "  3. When information is missing or ambiguous, DECIDE. Pick the most reasonable interpretation based on the ticket + codebase + industry standards, proceed, and record the decision in `assumptions`.",
    "  4. Prefer the BEST approach on the merits, not the 'safest' approach that defers the decision.",
    "  5. Do not stall, loop, or abandon the task. Always produce a complete report — even a partial analysis is better than no output.",
    "  6. Never output prose asking for confirmation, approval, or next steps. The only output is the final JSON report.",
    "",
    "=== TICKET ===",
    ticket,
    "",
    "=== CODEBASE ===",
    `Root path: ${opts.dirPath}`,
    focus ? `Focus area: ${focus}` : "Focus: whole codebase relevant to the ticket.",
    "",
    "=== INVESTIGATION STEPS (use Bash / Read / Grep / Glob) ===",
    `  1. ls ${opts.dirPath} and inspect top-level structure`,
    "  2. Read README / package.json / pyproject / go.mod etc. to understand the project",
    "  3. grep for keywords from the ticket (feature names, symbols, identifiers) to locate affected modules",
    "  4. Read the most relevant files (entrypoints, modules matching the ticket scope)",
    "  5. Cross-reference the ticket requirements against what the code currently does",
    "",
    "=== WRITE THE REPORT TO DISK ===",
    `  1. Ensure the docs directory exists: mkdir -p ${docsDir}`,
    "  2. Derive a slug from the ticket key/title (kebab-case, lowercase, alnum+dashes).",
    `  3. Write a markdown report to: ${docsDir}/<slug>-<YYYYMMDD-HHmm>.md`,
    "     Use a heredoc or the file tool. The markdown MUST contain sections:",
    "       # <Report Title>",
    "       ## Ticket Summary, ## Ticket Type, ## Codebase Summary,",
    "       ## Affected Areas, ## Findings (table: id | category | severity | title | location),",
    "       ## Assumptions, ## Risks, ## Recommendations,",
    "       ## Complexity, ## Readiness Score.",
    "  4. Verify the file exists with `ls -l` before returning.",
    "",
    "=== REPORT REQUIREMENTS (speckit-style) ===",
    "Return a structured JSON report with these fields:",
    "  - ticketSummary: 1-3 sentence plain-language summary of what the ticket asks for.",
    "  - ticketType: bug | feature | enhancement | task | refactor | other.",
    "  - codebaseSummary: what the relevant parts of the codebase currently do.",
    "  - affectedAreas: list of file paths / modules / components that would be touched.",
    "  - findings: array — each { id (F-001 style), category, severity, title, description, location?, recommendation? }.",
    "    categories: ambiguity | inconsistency | underspecified | duplication | risk | terminology | coverage-gap | assumption.",
    "    severity: critical | high | medium | low | info.",
    "  - assumptions: assumptions you had to make because the ticket was underspecified.",
    "  - risks: things that could go wrong during implementation (regressions, data loss, perf, security).",
    "  - recommendations: concrete next steps, ordered by priority.",
    "  - complexity: trivial | low | medium | high | very-high.",
    "  - readinessScore: 0-100. 100 = crystal clear; 0 = unworkable without clarification.",
    "  - reportTitle: short human title for the report, e.g. 'Analysis: <ticket key> — <short phrase>'.",
    "    Suitable for posting as a ticket comment heading.",
    "  - reportPath: absolute path of the markdown file you just wrote.",
    "  - summary: a concise ticket-comment-ready summary (markdown, 4-8 short lines or bullets).",
    "    Must include: 1-line TL;DR, ticket type, complexity, readiness score, top 3 findings by severity,",
    "    and a pointer line 'Full report: <reportPath>'. Written so a PM/engineer can skim and act.",
    "",
    "Return ONLY the JSON matching the schema. No prose outside of it.",
  ].join("\n");
}

/**
 * Autonomously analyzes a ticket against a codebase and returns a
 * speckit-style structured report: ticket classification, affected areas,
 * findings (with severity), assumptions, risks, recommendations, complexity,
 * and a readiness score. No human-in-the-loop — the agent makes reasonable
 * assumptions and records them.
 *
 * @param opts - dirPath (codebase), ticketContent (Jira/Linear/etc. payload),
 *   optional focus to narrow scope.
 * @returns A structured AnalyzeResult.
 *
 * @example
 * ```ts
 * const report = await analyze({
 *   dirPath: "/projects/api",
 *   ticketContent: "PROJ-123: Add rate limiting to /users endpoint...",
 * });
 * ```
 */
export async function analyze(opts: AnalyzeOptions): Promise<AnalyzeResult> {
  const { sessionId, queryOption } = resolveSession(opts.sessionId);
  log.info({ sessionId, dirPath: opts.dirPath, focus: opts.focus }, "analyze start");
  const controller = opts.signal
    ? (() => {
        const ac = new AbortController();
        if (opts.signal!.aborted) ac.abort(opts.signal!.reason);
        else opts.signal!.addEventListener("abort", () => ac.abort(opts.signal!.reason), { once: true });
        return ac;
      })()
    : undefined;
  let output: AnalyzeResult = { ...EMPTY_RESULT, sessionId };

  for await (const msg of query({
    prompt: buildPrompt(opts),
    options: {
      tools: ["Bash", "Read", "Glob", "Grep", "Write"],
      allowedTools: ["Bash", "Read", "Glob", "Grep", "Write"],
      permissionMode: "bypassPermissions",
      allowDangerouslySkipPermissions: true,
      maxTurns: 40,
      settingSources: [],
      settings: { allowedMcpServers: [] },
      outputFormat: { type: "json_schema", schema: OUTPUT_SCHEMA },
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
      ticketType: output.ticketType,
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
    dirPath: "/Users/admin/data/workspace/claude-skils/journeyman",
    ticketContent:
      "JM-42: Add a `dry-run` flag to checkoutRepo so callers can preview the git commands that would run without actually executing them. Must log the planned commands per repo and return success=true with a new `planned` array.",
  });
  process.stdout.write(JSON.stringify(result, null, 2) + "\n");
}
