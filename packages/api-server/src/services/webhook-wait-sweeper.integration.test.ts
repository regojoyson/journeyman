import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { NodeExecution, WorkflowInstance } from "@journeyman/core";
import { buildComposition, type Composition } from "../composition.ts";
import { WebhookWaitSweeper } from "./webhook-wait-sweeper.ts";
import { resolveHumanTask } from "./resolve-human-task.ts";

// End-to-end: an over-age paused webhook-wait is resolved via the timeout branch
// using the in-memory composition. Verifies status transitions and that the
// resolution row carries resolved_by = "max_age_sweep".

function pokeInstance(c: Composition, inst: WorkflowInstance) {
  (c.workflowInstances as unknown as { rows: Map<string, WorkflowInstance> }).rows.set(inst.id, inst);
}

function pokeExec(c: Composition, exec: NodeExecution) {
  (c.nodeExecutions as unknown as { rows: Map<string, NodeExecution> }).rows.set(exec.id, exec);
}

describe("webhook-wait sweeper (integration, memory store)", () => {
  const now = 1_700_000_000_000;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(now);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("resolves an over-age paused webhook-wait via the timeout branch", async () => {
    const c = buildComposition({
      databaseUrl: "",
      conductorBaseUrl: "http://unused",
      storeBackend: "memory",
    });

    const instanceId = "inst-1";
    const definitionSnapshot = {
      schemaVersion: 2,
      inputs: [],
      nodes: [{
        id: "n-wait",
        type: "webhook-wait",
        config: { outputs: [], timeout: { duration: "999d", defaults: { reason: "swept" } } },
      }],
      edges: [],
    } as never;

    pokeInstance(c, {
      id: instanceId,
      workflowId: null,
      workflowVersionId: null,
      workflowNameSnapshot: "test",
      workflowScopeSnapshot: "user",
      definitionSnapshot,
      status: "paused",
      triggerSource: "manual",
      startedByUserId: null,
      engineWorkflowId: null,
      startedAt: null,
      completedAt: null,
      durationMs: null,
      failedAtNodeId: null,
      inputs: { issueRef: "gh:org/repo#1" },
      outputs: null,
      attemptNumber: 1,
      webhookEventId: null,
      triggerNodeId: null,
      formSubmissionId: null,
    });

    pokeExec(c, {
      id: "exec-1",
      workflowInstanceId: instanceId,
      nodeId: "n-wait",
      attempt: 1,
      status: "waiting",
      startedAt: new Date(now - 7_200_000), // 2h ago
      completedAt: null,
      input: {},
      output: null,
      errorClass: null,
      errorMessage: null,
      conductorTaskId: "ct-1",
    });

    const sweeper = new WebhookWaitSweeper({
      maxAgeMs: 3_600_000, // 1h
      intervalMs: 60_000,
      batchSize: 500,
      nodeExecutions: c.nodeExecutions,
      workflowInstances: c.workflowInstances,
      fire: async (args) => {
        await resolveHumanTask(c, {
          workflowInstanceId: args.workflowInstanceId,
          nodeId: args.nodeId,
          values: args.defaults,
          payload: {},
          actor: null,
          source: "timeout",
          resolvedBy: "max_age_sweep",
        });
      },
    });

    await sweeper.tick();

    const exec = await c.nodeExecutions.latestForNode(instanceId, "n-wait");
    expect(exec?.status).toBe("completed");
    expect((exec?.output as Record<string, unknown>)?.source).toBe("timeout");
    expect((exec?.output as Record<string, unknown>)?.reason).toBe("swept");

    const resolutions = await c.humanTaskResolutions.listForRun(instanceId);
    expect(resolutions).toHaveLength(1);
    expect(resolutions[0].source).toBe("timeout");
    expect(resolutions[0].resolvedBy).toBe("max_age_sweep");
  });

  it("does not double-fire when invoked twice on the same row", async () => {
    const c = buildComposition({
      databaseUrl: "",
      conductorBaseUrl: "http://unused",
      storeBackend: "memory",
    });

    const instanceId = "inst-2";
    pokeInstance(c, {
      id: instanceId, workflowId: null, workflowVersionId: null,
      workflowNameSnapshot: "test", workflowScopeSnapshot: "user",
      definitionSnapshot: {
        schemaVersion: 2, inputs: [],
        nodes: [{ id: "n-wait", type: "webhook-wait", config: { outputs: [], timeout: { duration: "999d", defaults: {} } } }],
        edges: [],
      } as never,
      status: "paused", triggerSource: "manual", startedByUserId: null,
      engineWorkflowId: null, startedAt: null, completedAt: null, durationMs: null,
      failedAtNodeId: null, inputs: {}, outputs: null, attemptNumber: 1,
      webhookEventId: null, triggerNodeId: null, formSubmissionId: null,
    });

    pokeExec(c, {
      id: "exec-2", workflowInstanceId: instanceId, nodeId: "n-wait",
      attempt: 1, status: "waiting", startedAt: new Date(now - 7_200_000),
      completedAt: null, input: {}, output: null, errorClass: null,
      errorMessage: null, conductorTaskId: "ct-2",
    });

    const sweeper = new WebhookWaitSweeper({
      maxAgeMs: 3_600_000, intervalMs: 60_000, batchSize: 500,
      nodeExecutions: c.nodeExecutions, workflowInstances: c.workflowInstances,
      fire: async (args) => {
        await resolveHumanTask(c, {
          workflowInstanceId: args.workflowInstanceId, nodeId: args.nodeId,
          values: args.defaults, payload: {}, actor: null,
          source: "timeout", resolvedBy: "max_age_sweep",
        });
      },
    });

    await sweeper.tick();
    // After the first tick, the exec is completed → listOverAge... filters it out.
    await sweeper.tick();

    const resolutions = await c.humanTaskResolutions.listForRun(instanceId);
    expect(resolutions).toHaveLength(1);
  });
});
