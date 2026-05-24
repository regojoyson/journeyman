import { describe, it, expect, beforeEach, afterEach } from "vitest";
import pino from "pino";
import { createWorkflowLogger, loggerForRun, type WorkflowLogCtx } from "./workflow-logger.ts";

function captureLogs() {
  const lines: any[] = [];
  const logger = pino({ level: "debug" }, { write(s: string) { lines.push(JSON.parse(s)); } });
  return { logger, lines };
}

describe("createWorkflowLogger", () => {
  it("pre-binds correlation fields onto every log line", () => {
    const { logger, lines } = captureLogs();
    const ctx: WorkflowLogCtx = {
      workflowInstanceId: "wf-1", nodeId: "n-1", stepType: "clone-repos",
      attempt: 1, taskId: "t-1", workerId: "w-1",
    };
    const child = createWorkflowLogger(logger, ctx);
    child.info("hello");
    expect(lines[0]).toMatchObject({ ...ctx, msg: "hello" });
  });
});

describe("loggerForRun", () => {
  beforeEach(() => { delete process.env.DEBUG_WORKFLOW_IDS; });
  afterEach(() => { delete process.env.DEBUG_WORKFLOW_IDS; });

  it("returns default-level child when run id is not in DEBUG_WORKFLOW_IDS", () => {
    process.env.DEBUG_WORKFLOW_IDS = "other-id";
    const { logger, lines } = captureLogs();
    logger.level = "info";
    const child = loggerForRun(logger, {
      workflowInstanceId: "wf-1", nodeId: "n", stepType: "p", attempt: 1, taskId: "t", workerId: "w",
    });
    child.debug("debug-line");
    child.info("info-line");
    const msgs = lines.map(l => l.msg);
    expect(msgs).toContain("info-line");
    expect(msgs).not.toContain("debug-line");
  });

  it("raises matched runs to debug", () => {
    process.env.DEBUG_WORKFLOW_IDS = "wf-1,wf-2";
    const { logger, lines } = captureLogs();
    logger.level = "info";
    const child = loggerForRun(logger, {
      workflowInstanceId: "wf-1", nodeId: "n", stepType: "p", attempt: 1, taskId: "t", workerId: "w",
    });
    child.debug("debug-line");
    const msgs = lines.map(l => l.msg);
    expect(msgs).toContain("debug-line");
  });
});
