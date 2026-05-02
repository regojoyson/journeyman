// packages/coding-cli/src/providers/opencode/operations/plan.ts
import { createLogger } from "@journeyman/core";
import { logSessionEvent } from "../utils/sdk-logger.ts";
import type { OpenCodeClient } from "../client.ts";
import type { OpenCodeProviderConfig } from "../types.ts";
import type { PlanOptions, PlanResult } from "@journeyman/core";

const log = createLogger("opencode:plan");

const EMPTY_RESULT: Omit<PlanResult, "sessionId"> = {
  planTitle: "",
  goal: "",
  approachSummary: "",
  affectedFiles: [],
  steps: [],
  testStrategy: [],
  rolloutNotes: [],
  risks: [],
  openQuestions: [],
  estimatedComplexity: "medium",
  reportTitle: "",
  reportPath: "",
  summary: "",
};

const OUTPUT_SCHEMA = {
  type: "object",
  properties: {
    planTitle: { type: "string" },
    goal: { type: "string" },
    approachSummary: { type: "string" },
    affectedFiles: { type: "array", items: { type: "string" } },
    steps: {
      type: "array",
      items: {
        type: "object",
        properties: {
          id: { type: "string" },
          kind: { type: "string", enum: ["setup", "code-change", "refactor", "test", "config", "migration", "docs", "verification", "rollout"] },
          title: { type: "string" },
          description: { type: "string" },
          files: { type: "array", items: { type: "string" } },
          commands: { type: "array", items: { type: "string" } },
          acceptanceCriteria: { type: "array", items: { type: "string" } },
          dependsOn: { type: "array", items: { type: "string" } },
        },
        required: ["id", "kind", "title", "description"],
      },
    },
    testStrategy: { type: "array", items: { type: "string" } },
    rolloutNotes: { type: "array", items: { type: "string" } },
    risks: { type: "array", items: { type: "string" } },
    openQuestions: { type: "array", items: { type: "string" } },
    estimatedComplexity: { type: "string", enum: ["trivial", "low", "medium", "high", "very-high"] },
    reportTitle: { type: "string" },
    reportPath: { type: "string" },
    summary: { type: "string" },
    error: { type: "string" },
  },
  required: ["planTitle", "goal", "approachSummary", "affectedFiles", "steps", "testStrategy", "rolloutNotes", "risks", "openQuestions", "estimatedComplexity", "reportTitle", "reportPath", "summary"],
} as const;

const DEFAULT_TOOLS: Record<string, boolean> = { bash: true, read: true, glob: true, grep: true, write: true };

function buildPrompt(opts: PlanOptions): string {
  const root = opts.repoDir.replace(/\/+$/, "");
  const ticket = opts.ticketContent?.trim() || "(no ticket content provided — derive goal from analyze report)";
  const focus = opts.focus?.trim();
  const analyzeDir = `${root}/docs/analyze`;
  const planDir = `${root}/docs/plan`;
  const explicitReport = opts.analyzeReportPath?.trim();
  const reviewBlock = opts.reviewComments
    ? `\n\n## Reviewer feedback (address in the revised plan)\n\n${opts.reviewComments}\n`
    : "";

  return [
    "You are a senior staff engineer producing an autonomous, speckit-style IMPLEMENTATION PLAN.",
    "",
    "=== AUTONOMY RULES (non-negotiable) ===",
    "  1. This run is FULLY AUTONOMOUS. There is no human on the other end. Nobody will answer you.",
    "  2. NEVER ask clarifying questions — not in text, not via tools. Questions will not be read.",
    "  3. When information is missing or ambiguous, DECIDE. Record the decision in `openQuestions`.",
    "  4. Prefer the BEST approach on the merits. Choose a concrete design — do not emit a plan full of 'TBD'.",
    "  5. Do not stall, loop, or abandon the task. Always produce a complete plan.",
    "  6. Never output prose asking for confirmation. The only output is the final JSON plan.",
    `${reviewBlock}`,
    "=== TICKET / GOAL ===",
    ticket,
    "",
    "=== CODEBASE ===",
    `Root path: ${root}`,
    focus ? `Focus area: ${focus}` : "Focus: whole codebase relevant to the goal.",
    "",
    "=== STEP 1: LOAD THE PRIOR ANALYZE REPORT ===",
    explicitReport
      ? `  - An analyze report path was provided: ${explicitReport}. Read it in full.`
      : [
          `  - Check if ${analyzeDir} exists (ls -la).`,
          `  - If it exists, pick the MOST RECENT markdown report and read it in full.`,
          `  - If the directory is missing or empty, proceed using only the ticket + codebase (note this in openQuestions).`,
        ].join("\n"),
    "  - Extract: affected areas, findings, assumptions, risks, recommendations, readiness score.",
    "  - Your plan must directly address the findings and recommendations from the analyze report.",
    "",
    "=== STEP 2: INVESTIGATE THE CODE (Bash / Read / Grep / Glob) ===",
    `  1. ls ${root} and read the key files mentioned in the analyze report.`,
    "  2. For each affected area, read the actual current code so the plan references real functions, paths, and line numbers.",
    "  3. Check for existing tests covering the affected areas.",
    "",
    "=== STEP 3: WRITE THE PLAN REPORT TO DISK ===",
    `  1. mkdir -p ${planDir}`,
    "  2. Derive a slug from the ticket key/title (kebab-case, lowercase).",
    `  3. Write markdown to: ${planDir}/<slug>-<YYYYMMDD-HHmm>.md`,
    "     Required sections: # Plan Title, ## Goal, ## Approach Summary, ## Affected Files, ## Steps, ## Test Strategy, ## Rollout Notes, ## Risks, ## Open Questions, ## Estimated Complexity, ## Linked Analyze Report.",
    "  4. Verify the file exists with `ls -l` before returning.",
    "",
    "=== REPORT REQUIREMENTS (speckit-style) ===",
    "Return a structured JSON plan with: planTitle, goal, approachSummary, affectedFiles, steps (each: id S-001.., kind, title, description, files?, commands?, acceptanceCriteria?, dependsOn?), testStrategy, rolloutNotes, risks, openQuestions, estimatedComplexity, reportTitle, reportPath, summary.",
    "",
    "Return ONLY the JSON matching the schema. No prose outside of it.",
  ].join("\n");
}

export async function plan(
  client: OpenCodeClient,
  config: OpenCodeProviderConfig,
  opts: PlanOptions,
): Promise<PlanResult> {
  const sessionId = opts.sessionId ?? crypto.randomUUID();
  log.info({ sessionId, repoDir: opts.repoDir, focus: opts.focus }, "plan start");

  const session = await client.session.create({ title: "plan" });
  if (!session.data) throw new Error("opencode session.create returned no data");
  const sid = session.data.id;

  const result = await client.session.prompt({
    sessionID: sid,
    parts: [{ type: "text", text: buildPrompt(opts) }],
    model: config.model,
    tools: { ...DEFAULT_TOOLS, ...(config.tools ?? {}) },
    format: { type: "json_schema", schema: OUTPUT_SCHEMA },
  });
  if (!result.data) throw new Error("opencode session.prompt returned no data");

  const info = result.data.info;
  logSessionEvent(log, sessionId, info);

  if (info.error) {
    const error = typeof info.error === "string" ? info.error : JSON.stringify(info.error);
    log.error({ sessionId, error }, "plan failed");
    return { ...EMPTY_RESULT, sessionId, error };
  }
  if (!info.structured) return { ...EMPTY_RESULT, sessionId };

  const output = { ...(info.structured as PlanResult), sessionId };
  log.info({
    sessionId,
    stepCount: output.steps.length,
    complexity: output.estimatedComplexity,
    reportPath: output.reportPath,
  }, "plan done");
  return output;
}
