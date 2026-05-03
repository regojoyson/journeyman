import { query } from "@anthropic-ai/claude-agent-sdk";
import { createLogger } from "@journeyman/core";
import { logSdkMessage } from "../utils/sdk-logger.ts";
import { resolveSession } from "../utils/session.ts";
import type { ImplementOptions, ImplementResult } from "@journeyman/core";

const log = createLogger("claude:implement");

export type { ImplementOptions, ImplementResult };

const EMPTY_RESULT: Omit<ImplementResult, "sessionId"> = {
  success: false,
  implementationTitle: "",
  approachSummary: "",
  filesChanged: [],
  steps: [],
  testsRun: [],
  testsPassed: false,
  followUps: [],
  reportTitle: "",
  reportPath: "",
  summary: "",
};

const OUTPUT_SCHEMA = {
  type: "object",
  properties: {
    success: { type: "boolean" },
    implementationTitle: { type: "string" },
    approachSummary: { type: "string" },
    filesChanged: {
      type: "array",
      items: {
        type: "object",
        properties: {
          path: { type: "string" },
          kind: { type: "string", enum: ["created", "modified", "deleted"] },
          summary: { type: "string" },
        },
        required: ["path", "kind", "summary"],
      },
    },
    steps: {
      type: "array",
      items: {
        type: "object",
        properties: {
          id: { type: "string" },
          title: { type: "string" },
          status: { type: "string", enum: ["done", "skipped", "partial", "failed"] },
          notes: { type: "string" },
        },
        required: ["id", "title", "status"],
      },
    },
    testsRun: { type: "array", items: { type: "string" } },
    testsPassed: { type: "boolean" },
    followUps: { type: "array", items: { type: "string" } },
    reportTitle: { type: "string" },
    reportPath: { type: "string" },
    summary: { type: "string" },
    error: { type: "string" },
  },
  required: [
    "success",
    "implementationTitle",
    "approachSummary",
    "filesChanged",
    "steps",
    "testsRun",
    "testsPassed",
    "followUps",
    "reportTitle",
    "reportPath",
    "summary",
  ],
} as const;

const DEFAULT_RULES = [
  "Follow the existing code style, naming conventions, and project structure — match what's already in the repo.",
  "Do NOT introduce new dependencies unless the plan explicitly requires one. Prefer existing utilities.",
  "Keep the change MINIMAL and SCOPED to the plan. Do not refactor unrelated code or bundle drive-by cleanups.",
  "Preserve backwards compatibility for public APIs unless the plan explicitly calls for a breaking change.",
  "Do not delete or modify unrelated tests. Keep unrelated files untouched.",
  "Do not commit, push, or create branches. Only edit the working tree.",
  "Do not leak secrets, tokens, or absolute machine-specific paths into code or reports.",
  "Never use destructive git commands (reset --hard, clean -fd, push --force, branch -D).",
  "Prefer small, well-named functions over clever one-liners. Readability > cleverness.",
  "Do not add comments that merely restate the code. Only comment non-obvious WHY.",
  "If a plan step is ambiguous, make a reasonable assumption, implement it, and record the assumption in followUps.",
  "If an edit is impossible (e.g. target file missing), mark that step status 'failed' with a clear note and continue.",
  "After implementation, run the project's typecheck / tests if available and report the exact commands in testsRun.",
];

function buildPrompt(opts: ImplementOptions): string {
  const root = opts.repoDir.replace(/\/+$/, "");
  const issue = opts.issueContent?.trim() || "(no issue content provided — derive from plan / analyze reports)";
  const focus = opts.focus?.trim();
  const analyzeDir = `${root}/docs/analyze`;
  const planDir = `${root}/docs/plan`;
  const implDir = `${root}/docs/implement`;
  const explicitAnalyze = opts.analyzeReportPath?.trim();
  const explicitPlan = opts.planReportPath?.trim();

  const rules = [...DEFAULT_RULES, ...(opts.extraRules ?? [])]
    .map((r, i) => `  ${i + 1}. ${r}`)
    .join("\n");

  const reviewBlock = opts.reviewComments
    ? `\n\n## Reviewer feedback (address during implementation)\n\n${opts.reviewComments}\n`
    : "";

  return [
    "You are a senior staff engineer IMPLEMENTING a issue autonomously.",
    "",
    "=== AUTONOMY RULES (non-negotiable) ===",
    "  1. This run is FULLY AUTONOMOUS. There is no human on the other end. Nobody will answer you.",
    "  2. NEVER ask clarifying questions — not in text, not via tools. Questions will not be read.",
    "  3. When information is missing or ambiguous, DECIDE. Pick the most reasonable approach based on the issue + analyze + plan + existing codebase conventions + industry standards, proceed with the edits, and record the decision in `followUps`.",
    "  4. Prefer the BEST approach on the merits, not the 'safest' approach that defers the decision. Ship working code — do not leave TODO stubs where a real implementation is expected.",
    "  5. Do not stall, loop, or abandon the task. If a step is blocked, mark that step 'failed' with a clear note and move on to the next step.",
    "  6. Never output prose asking for confirmation, approval, or next steps. The only output is the final JSON report.",
    `${reviewBlock}`,
    "=== TICKET / GOAL ===",
    issue,
    "",
    "=== CODEBASE ===",
    `Root path: ${root}`,
    focus ? `Focus area: ${focus}` : "Focus: whatever the plan + analyze reports indicate.",
    "",
    "=== IMPLEMENTATION RULES (non-negotiable) ===",
    rules,
    "",
    "=== STEP 1: LOAD PRIOR REPORTS ===",
    explicitAnalyze
      ? `  - Analyze report provided: ${explicitAnalyze}. Read it in full.`
      : `  - Check ${analyzeDir}. If present, read the MOST RECENT markdown report in full. If absent, note in followUps.`,
    explicitPlan
      ? `  - Plan report provided: ${explicitPlan}. Read it in full.`
      : `  - Check ${planDir}. If present, read the MOST RECENT markdown plan in full. The plan's Steps section drives this work.`,
    "  - If the plan is missing, derive a minimal ordered step list from the issue + analyze report yourself before coding.",
    "",
    "=== STEP 2: IMPLEMENT ===",
    "  - Work through the plan's steps in order. For each step:",
    "      a. Read the target files (never edit blind).",
    "      b. Apply the edit with Edit/Write.",
    "      c. Record the change in filesChanged and the step outcome in steps[].",
    "  - Respect all rules above. Stay within the scope of the plan.",
    "",
    "=== STEP 3: VERIFY ===",
    `  - Detect the project's verification command(s) by inspecting package.json / Makefile / pyproject / go.mod at ${root}.`,
    "  - Preferred order: typecheck → lint → unit tests. Run whatever exists. Capture exact commands in testsRun.",
    "  - Set testsPassed=true only if every command you ran exited 0. If any failed, set success=false and include the failure in followUps.",
    "",
    "=== STEP 4: WRITE THE IMPLEMENTATION REPORT TO DISK ===",
    `  1. mkdir -p ${implDir}`,
    "  2. Derive a slug from the issue key / plan title (kebab-case, lowercase).",
    `  3. Write markdown to: ${implDir}/<slug>-<YYYYMMDD-HHmm>.md`,
    "     Required sections:",
    "       # <Implementation Title>",
    "       ## Approach Summary",
    "       ## Files Changed (table: path | kind | summary)",
    "       ## Steps Executed (table: id | title | status | notes)",
    "       ## Tests Run (command + outcome)",
    "       ## Follow-ups",
    "       ## Linked Analyze Report (path)",
    "       ## Linked Plan Report (path)",
    "  4. Verify the file exists with `ls -l` before returning.",
    "",
    "=== RETURN JSON ===",
    "  - success: true only if all plan steps are done AND testsPassed is true.",
    "  - implementationTitle: short human title, e.g. 'Implementation: <issue key> — <short phrase>'.",
    "  - approachSummary: 3-6 sentences on what you did and why.",
    "  - filesChanged: every file touched with { path, kind, summary }.",
    "  - steps: per-step outcome.",
    "  - testsRun: exact commands. testsPassed: overall verification result.",
    "  - followUps: assumptions made, skipped items, known gaps.",
    "  - reportTitle: SHORT issue-comment heading.",
    "  - reportPath: absolute path of the markdown report.",
    "  - summary: issue-comment-ready markdown (4-8 lines). Must include TL;DR, success flag, #files changed,",
    "    typecheck/test result, top follow-up, and 'Full report: <reportPath>'.",
    "",
    "Return ONLY the JSON matching the schema. No prose outside of it.",
  ].join("\n");
}

/**
 * Autonomously implements a issue in a local codebase. Reads the latest
 * analyze + plan reports from docs/analyze and docs/plan, applies the plan's
 * steps through Edit/Write, runs the project's typecheck/tests, writes an
 * implementation report to docs/implement, and returns a structured
 * ImplementResult with a issue-comment-ready title/path/summary.
 *
 * Does NOT commit, push, or create branches — strictly a working-tree edit.
 */
export async function implement(opts: ImplementOptions): Promise<ImplementResult> {
  const { sessionId, queryOption } = resolveSession(opts.sessionId);
  log.info({ sessionId, repoDir: opts.repoDir, focus: opts.focus }, "implement start");
  const controller = opts.signal
    ? (() => {
        const ac = new AbortController();
        if (opts.signal!.aborted) ac.abort(opts.signal!.reason);
        else opts.signal!.addEventListener("abort", () => ac.abort(opts.signal!.reason), { once: true });
        return ac;
      })()
    : undefined;
  let output: ImplementResult = { ...EMPTY_RESULT, sessionId };

  for await (const msg of query({
    prompt: buildPrompt(opts),
    options: {
      tools: ["Bash", "Read", "Glob", "Grep", "Write", "Edit"],
      allowedTools: ["Bash", "Read", "Glob", "Grep", "Write", "Edit"],
      permissionMode: "bypassPermissions",
      allowDangerouslySkipPermissions: true,
      maxTurns: 120,
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
        log.error({ sessionId, error }, "implement failed");
        return { ...EMPTY_RESULT, sessionId, error };
      }
      output = { ...(msg.structured_output as ImplementResult), sessionId };
    }
  }

  log.info(
    {
      sessionId,
      success: output.success,
      filesChanged: output.filesChanged.length,
      stepCount: output.steps.length,
      testsPassed: output.testsPassed,
      reportPath: output.reportPath,
    },
    "implement done",
  );
  return output;
}

// Run: npx tsx implement.ts
if (import.meta.url === `file://${process.argv[1]}`) {
  const result = await implement({
    repoDir: "/Users/admin/data/workspace/claude-skils/journeyman",
    issueContent:
      "JM-42: Add a `dry-run` flag to checkoutRepo so callers can preview the git commands that would run without actually executing them.",
  });
  process.stdout.write(JSON.stringify(result, null, 2) + "\n");
}
