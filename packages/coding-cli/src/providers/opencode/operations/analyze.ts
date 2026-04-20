// packages/coding-cli/src/providers/opencode/operations/analyze.ts
import { createLogger } from "@journeyman/core";
import { logSessionEvent } from "../utils/sdk-logger.ts";
import type { OpenCodeClient } from "../client.ts";
import type { OpenCodeProviderConfig } from "../types.ts";
import type { AnalyzeOptions, AnalyzeResult } from "@journeyman/core";

const log = createLogger("opencode:analyze");

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
    ticketType: { type: "string", enum: ["bug", "feature", "enhancement", "task", "refactor", "other"] },
    codebaseSummary: { type: "string" },
    affectedAreas: { type: "array", items: { type: "string" } },
    findings: {
      type: "array",
      items: {
        type: "object",
        properties: {
          id: { type: "string" },
          category: { type: "string", enum: ["ambiguity", "inconsistency", "underspecified", "duplication", "risk", "terminology", "coverage-gap", "assumption"] },
          severity: { type: "string", enum: ["critical", "high", "medium", "low", "info"] },
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
    complexity: { type: "string", enum: ["trivial", "low", "medium", "high", "very-high"] },
    readinessScore: { type: "number", minimum: 0, maximum: 100 },
    reportTitle: { type: "string" },
    reportPath: { type: "string" },
    summary: { type: "string" },
    error: { type: "string" },
  },
  required: ["ticketSummary", "ticketType", "codebaseSummary", "affectedAreas", "findings", "assumptions", "risks", "recommendations", "complexity", "readinessScore", "reportTitle", "reportPath", "summary"],
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
    "  - risks: things that could go wrong during implementation.",
    "  - recommendations: concrete next steps, ordered by priority.",
    "  - complexity: trivial | low | medium | high | very-high.",
    "  - readinessScore: 0-100. 100 = crystal clear; 0 = unworkable without clarification.",
    "  - reportTitle: short human title for the report.",
    "  - reportPath: absolute path of the markdown file you just wrote.",
    "  - summary: a concise ticket-comment-ready summary (markdown, 4-8 short lines or bullets).",
    "",
    "Return ONLY the JSON matching the schema. No prose outside of it.",
  ].join("\n");
}

export async function analyze(
  client: OpenCodeClient,
  config: OpenCodeProviderConfig,
  opts: AnalyzeOptions,
): Promise<AnalyzeResult> {
  const sessionId = opts.sessionId ?? crypto.randomUUID();
  log.info({ sessionId, dirPath: opts.dirPath, focus: opts.focus }, "analyze start");

  const session = await client.session.create({ title: "analyze" });
  if (!session.data) throw new Error("opencode session.create returned no data");
  const sid = session.data.id;

  const result = await client.session.prompt({
    sessionID: sid,
    parts: [{ type: "text", text: buildPrompt(opts) }],
    model: config.model,
    tools: config.tools,
    format: { type: "json_schema", schema: OUTPUT_SCHEMA },
  });
  if (!result.data) throw new Error("opencode session.prompt returned no data");

  const info = result.data.info;
  logSessionEvent(log, sessionId, info);

  if (info.error) {
    const error = typeof info.error === "string" ? info.error : JSON.stringify(info.error);
    log.error({ sessionId, error }, "analyze failed");
    return { ...EMPTY_RESULT, sessionId, error };
  }
  if (!info.structured) return { ...EMPTY_RESULT, sessionId };

  const output = { ...(info.structured as AnalyzeResult), sessionId };
  log.info({
    sessionId,
    ticketType: output.ticketType,
    complexity: output.complexity,
    readinessScore: output.readinessScore,
    findingCount: output.findings.length,
    reportPath: output.reportPath,
  }, "analyze done");
  return output;
}
