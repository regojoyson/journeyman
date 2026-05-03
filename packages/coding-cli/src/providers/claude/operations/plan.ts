import { query } from "@anthropic-ai/claude-agent-sdk";
import { createLogger, formatIssueForPrompt } from "@journeyman/core";
import { logSdkMessage } from "../utils/sdk-logger.ts";
import { resolveSession } from "../utils/session.ts";
import type { PlanOptions, PlanResult } from "@journeyman/core";

const log = createLogger("claude:plan");

export type { PlanOptions, PlanResult };

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
          kind: {
            type: "string",
            enum: [
              "setup",
              "code-change",
              "refactor",
              "test",
              "config",
              "migration",
              "docs",
              "verification",
              "rollout",
            ],
          },
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
    estimatedComplexity: {
      type: "string",
      enum: ["trivial", "low", "medium", "high", "very-high"],
    },
    reportTitle: { type: "string" },
    reportPath: { type: "string" },
    summary: { type: "string" },
    error: { type: "string" },
  },
  required: [
    "planTitle",
    "goal",
    "approachSummary",
    "affectedFiles",
    "steps",
    "testStrategy",
    "rolloutNotes",
    "risks",
    "openQuestions",
    "estimatedComplexity",
    "reportTitle",
    "reportPath",
    "summary",
  ],
} as const;

function buildPrompt(opts: PlanOptions): string {
  const root = opts.workspaceDir.replace(/\/+$/, "");
  const issue = opts.issue ? formatIssueForPrompt(opts.issue) : "(no issue provided — derive goal from analyze report)";
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
    "  3. When information is missing or ambiguous, DECIDE. Pick the most reasonable interpretation based on the issue + analyze report + codebase + industry standards, proceed, and record the decision in `openQuestions`.",
    "  4. Prefer the BEST approach on the merits, not the 'safest' approach that defers the decision. Choose a concrete design — do not emit a plan full of 'TBD' or 'decide later'.",
    "  5. Do not stall, loop, or abandon the task. Always produce a complete plan — even a rough plan is better than no output.",
    "  6. Never output prose asking for confirmation, approval, or next steps. The only output is the final JSON plan.",
    `${reviewBlock}`,
    "=== TICKET / GOAL ===",
    issue,
    "",
    "=== WORKSPACE ===",
    `Workspace root: ${root}`,
    "(may contain one or more cloned repos as subdirectories)",
    focus ? `Focus area: ${focus}` : "Focus: whole codebase relevant to the goal.",
    "",
    "=== STEP 1: LOAD THE PRIOR ANALYZE REPORT ===",
    explicitReport
      ? `  - An analyze report path was provided: ${explicitReport}. Read it in full.`
      : [
          `  - Check if ${analyzeDir} exists (ls -la).`,
          `  - If it exists, pick the MOST RECENT markdown report (by filename timestamp or mtime) and read it in full.`,
          `  - If the directory is missing or empty, proceed using only the issue + codebase (note this in openQuestions).`,
        ].join("\n"),
    "  - Extract: affected areas, findings, assumptions, risks, recommendations, readiness score.",
    "  - Your plan must directly address the findings and recommendations from the analyze report.",
    "",
    "=== STEP 2: INVESTIGATE THE CODE (Bash / Read / Grep / Glob) ===",
    `  1. ls ${root} and read the key files mentioned in the analyze report (or identified from the issue).`,
    "  2. For each affected area, read the actual current code so the plan references real functions, paths, and line numbers.",
    "  3. Check for existing tests covering the affected areas.",
    "",
    "=== STEP 3: WRITE THE PLAN REPORT TO DISK ===",
    `  1. mkdir -p ${planDir}`,
    "  2. Derive a slug from the issue key/title (kebab-case, lowercase).",
    `  3. Write markdown to: ${planDir}/<slug>-<YYYYMMDD-HHmm>.md`,
    "     Required sections:",
    "       # <Plan Title>",
    "       ## Goal",
    "       ## Approach Summary",
    "       ## Affected Files",
    "       ## Steps (numbered, each with: kind, title, description, files, commands, acceptance criteria, dependsOn)",
    "       ## Test Strategy",
    "       ## Rollout Notes",
    "       ## Risks",
    "       ## Open Questions",
    "       ## Estimated Complexity",
    "       ## Linked Analyze Report (path)",
    "  4. Verify the file exists with `ls -l` before returning.",
    "",
    "=== REPORT REQUIREMENTS (speckit-style) ===",
    "Return a structured JSON plan with these fields:",
    "  - planTitle: short human title, e.g. 'Plan: <issue key> — <short phrase>'.",
    "  - goal: 1-3 sentence plain-language statement of what will be achieved.",
    "  - approachSummary: 3-6 sentence technical approach.",
    "  - affectedFiles: concrete file paths that will be created / modified / deleted.",
    "  - steps: ordered array. Each { id (S-001..), kind, title, description, files?, commands?, acceptanceCriteria?, dependsOn? }.",
    "    kinds: setup | code-change | refactor | test | config | migration | docs | verification | rollout.",
    "    Each step must be small enough to implement + verify independently.",
    "  - testStrategy: how correctness is verified (unit / integration / manual checks).",
    "  - rolloutNotes: deployment / feature-flag / migration notes.",
    "  - risks: what could go wrong during implementation.",
    "  - openQuestions: assumptions you had to make; things a human should confirm.",
    "  - estimatedComplexity: trivial | low | medium | high | very-high.",
    "  - reportTitle: SHORT human title suitable as a issue-comment heading, e.g. 'Implementation Plan: <issue key> — <short phrase>'.",
    "  - reportPath: absolute path of the markdown plan you just wrote.",
    "  - summary: issue-comment-ready markdown, 4-8 short lines or bullets. Must include:",
    "    1-line TL;DR, complexity, number of steps, top risk, and a pointer line 'Full plan: <reportPath>'.",
    "",
    "Return ONLY the JSON matching the schema. No prose outside of it.",
  ].join("\n");
}

/**
 * Autonomously produces a speckit-style implementation plan for a issue,
 * grounded in the most recent analyze report (docs/analyze/) and the actual
 * codebase. Writes a markdown plan to docs/plan/ and returns a structured
 * PlanResult including a reportTitle/reportPath/summary suitable for posting
 * as a issue comment.
 */
export async function plan(opts: PlanOptions): Promise<PlanResult> {
  const { sessionId, queryOption } = resolveSession(opts.sessionId);
  log.info({ sessionId, workspaceDir: opts.workspaceDir, focus: opts.focus }, "plan start");
  const controller = opts.signal
    ? (() => {
        const ac = new AbortController();
        if (opts.signal!.aborted) ac.abort(opts.signal!.reason);
        else opts.signal!.addEventListener("abort", () => ac.abort(opts.signal!.reason), { once: true });
        return ac;
      })()
    : undefined;
  let output: PlanResult = { ...EMPTY_RESULT, sessionId };

  for await (const msg of query({
    prompt: buildPrompt(opts),
    options: {
      tools: ["Bash", "Read", "Glob", "Grep", "Write"],
      allowedTools: ["Bash", "Read", "Glob", "Grep", "Write"],
      permissionMode: "bypassPermissions",
      allowDangerouslySkipPermissions: true,
      maxTurns: 60,
      settingSources: [],
      settings: { allowedMcpServers: [] },
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
        log.error({ sessionId, error }, "plan failed");
        return { ...EMPTY_RESULT, sessionId, error };
      }
      output = { ...(msg.structured_output as PlanResult), sessionId };
    }
  }

  log.info(
    {
      sessionId,
      stepCount: output.steps.length,
      complexity: output.estimatedComplexity,
      reportPath: output.reportPath,
    },
    "plan done",
  );
  return output;
}

// Run: npx tsx plan.ts
if (import.meta.url === `file://${process.argv[1]}`) {
  const result = await plan({
    workspaceDir: "/Users/admin/data/workspace/claude-skils/journeyman",
    issue: {
      id: "JM-42",
      title: "Add `dry-run` flag to checkoutRepo",
      description:
        "Add a `dry-run` flag to checkoutRepo so callers can preview the git commands that would run without actually executing them.",
    },
  });
  process.stdout.write(JSON.stringify(result, null, 2) + "\n");
}
