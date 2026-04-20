// packages/coding-cli/src/providers/opencode/operations/implement.ts
import { createLogger } from "@journeyman/core";
import { logSessionEvent } from "../utils/sdk-logger.ts";
import type { OpenCodeClient } from "../client.ts";
import type { OpenCodeProviderConfig } from "../types.ts";
import type { ImplementOptions, ImplementResult } from "@journeyman/core";

const log = createLogger("opencode:implement");

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
  required: ["success", "implementationTitle", "approachSummary", "filesChanged", "steps", "testsRun", "testsPassed", "followUps", "reportTitle", "reportPath", "summary"],
} as const;

const DEFAULT_TOOLS: Record<string, boolean> = { bash: true, read: true, glob: true, grep: true, write: true, edit: true };

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
  const root = opts.dirPath.replace(/\/+$/, "");
  const ticket = opts.ticketContent?.trim() || "(no ticket content provided — derive from plan / analyze reports)";
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
    "You are a senior staff engineer IMPLEMENTING a ticket autonomously.",
    "",
    "=== AUTONOMY RULES (non-negotiable) ===",
    "  1. This run is FULLY AUTONOMOUS. There is no human on the other end. Nobody will answer you.",
    "  2. NEVER ask clarifying questions. Questions will not be read.",
    "  3. When information is missing or ambiguous, DECIDE. Record the decision in `followUps`.",
    "  4. Ship working code — do not leave TODO stubs where a real implementation is expected.",
    "  5. If a step is blocked, mark it 'failed' with a clear note and move on.",
    "  6. Never output prose asking for confirmation. The only output is the final JSON report.",
    `${reviewBlock}`,
    "=== TICKET / GOAL ===",
    ticket,
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
    "  - If the plan is missing, derive a minimal ordered step list from the ticket + analyze report yourself before coding.",
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
    "  - Set testsPassed=true only if every command you ran exited 0.",
    "",
    "=== STEP 4: WRITE THE IMPLEMENTATION REPORT TO DISK ===",
    `  1. mkdir -p ${implDir}`,
    "  2. Derive a slug from the ticket key / plan title (kebab-case, lowercase).",
    `  3. Write markdown to: ${implDir}/<slug>-<YYYYMMDD-HHmm>.md`,
    "     Required sections: # Implementation Title, ## Approach Summary, ## Files Changed, ## Steps Executed, ## Tests Run, ## Follow-ups, ## Linked Analyze Report, ## Linked Plan Report.",
    "  4. Verify the file exists with `ls -l` before returning.",
    "",
    "=== RETURN JSON ===",
    "  success: true only if all plan steps are done AND testsPassed is true.",
    "  implementationTitle, approachSummary, filesChanged, steps, testsRun, testsPassed, followUps, reportTitle, reportPath, summary.",
    "",
    "Return ONLY the JSON matching the schema. No prose outside of it.",
  ].join("\n");
}

export async function implement(
  client: OpenCodeClient,
  config: OpenCodeProviderConfig,
  opts: ImplementOptions,
): Promise<ImplementResult> {
  const sessionId = opts.sessionId ?? crypto.randomUUID();
  log.info({ sessionId, dirPath: opts.dirPath, focus: opts.focus }, "implement start");

  const session = await client.session.create({ title: "implement" });
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
    log.error({ sessionId, error }, "implement failed");
    return { ...EMPTY_RESULT, sessionId, error };
  }
  if (!info.structured) return { ...EMPTY_RESULT, sessionId };

  const output = { ...(info.structured as ImplementResult), sessionId };
  log.info({
    sessionId,
    success: output.success,
    filesChanged: output.filesChanged.length,
    stepCount: output.steps.length,
    testsPassed: output.testsPassed,
    reportPath: output.reportPath,
  }, "implement done");
  return output;
}
