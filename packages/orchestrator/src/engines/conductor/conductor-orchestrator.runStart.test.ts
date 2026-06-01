import { describe, it, expect, vi } from "vitest";
import { ConductorOrchestrator } from "./conductor-orchestrator.ts";

function makeArgs() {
  return {
    workflowId: "wf-1",
    workflowVersionId: "ver-1",
    workflowNameSnapshot: "demo",
    workflowScopeSnapshot: "org" as const,
    definitionSnapshot: { nodes: [], edges: [], attributeDefs: [], defaults: {} } as never,
    inputs: {},
    startedByUserId: "u-1",
    startedByOrgId: "o-1",
    triggerSource: "webhook" as const,
  };
}

function makeDeps(overrides: Record<string, unknown> = {}) {
  const created = { id: "wi-1" };
  return {
    deps: {
      client: {
        putWorkflowDef: vi.fn().mockResolvedValue(undefined),
        startWorkflow: vi.fn().mockResolvedValue("eng-1"),
      },
      converter: { toEngineJson: vi.fn().mockReturnValue({ name: "n", version: 1, tasks: [] }) },
      workflowInstances: {
        create: vi.fn().mockResolvedValue(created),
        setStatus: vi.fn().mockResolvedValue(undefined),
        setEngineWorkflowId: vi.fn().mockResolvedValue(undefined),
      },
      workflowInstanceGrants: { createForInstance: vi.fn().mockResolvedValue(undefined) },
      events: { append: vi.fn().mockResolvedValue(undefined) },
      ...overrides,
    } as never,
    created,
  };
}

describe("ConductorOrchestrator async start", () => {
  it("submit() returns immediately with provisioning status and null engineWorkflowId, without awaiting the slow provisioner", async () => {
    let resolveProvision!: () => void;
    const provisionPending = new Promise<void>((r) => { resolveProvision = r; });
    const sandboxProvisioner = vi.fn().mockReturnValue(provisionPending);
    const { deps } = makeDeps({ sandboxProvisioner });
    const orch = new ConductorOrchestrator(deps);

    const result = await orch.submit(makeArgs());

    expect(result).toEqual({ workflowInstanceId: "wi-1", engineWorkflowId: null });
    expect((deps as never as { workflowInstances: { setStatus: ReturnType<typeof vi.fn> } }).workflowInstances.setStatus)
      .toHaveBeenCalledWith("wi-1", "provisioning");
    // startWorkflow must NOT have run yet — the provisioner is still pending.
    expect((deps as never as { client: { startWorkflow: ReturnType<typeof vi.fn> } }).client.startWorkflow)
      .not.toHaveBeenCalled();
    resolveProvision();
  });

  it("runStart() provisions, then starts the workflow, sets running, and records the engine id", async () => {
    const sandboxProvisioner = vi.fn().mockResolvedValue(undefined);
    const { deps } = makeDeps({ sandboxProvisioner });
    const d = deps as never as {
      client: { startWorkflow: ReturnType<typeof vi.fn> };
      workflowInstances: { setStatus: ReturnType<typeof vi.fn>; setEngineWorkflowId: ReturnType<typeof vi.fn> };
    };
    const orch = new ConductorOrchestrator(deps);

    await orch.runStart("wi-1", "journeyman_vver_1", makeArgs());

    expect(sandboxProvisioner).toHaveBeenCalledOnce();
    expect(d.client.startWorkflow).toHaveBeenCalledOnce();
    expect(d.workflowInstances.setEngineWorkflowId).toHaveBeenCalledWith("wi-1", "eng-1");
    expect(d.workflowInstances.setStatus).toHaveBeenCalledWith("wi-1", "running");
    // provision happened before start
    expect(sandboxProvisioner.mock.invocationCallOrder[0])
      .toBeLessThan(d.client.startWorkflow.mock.invocationCallOrder[0]);
  });

  it("runStart() marks the run failed and never starts the workflow when provisioning throws", async () => {
    const sandboxProvisioner = vi.fn().mockRejectedValue(new Error("build boom"));
    const { deps } = makeDeps({ sandboxProvisioner });
    const d = deps as never as {
      client: { startWorkflow: ReturnType<typeof vi.fn> };
      workflowInstances: { setStatus: ReturnType<typeof vi.fn> };
      events: { append: ReturnType<typeof vi.fn> };
    };
    const orch = new ConductorOrchestrator(deps);

    await orch.runStart("wi-1", "journeyman_vver_1", makeArgs());

    expect(d.client.startWorkflow).not.toHaveBeenCalled();
    expect(d.workflowInstances.setStatus).toHaveBeenCalledWith("wi-1", "failed", expect.anything());
    expect(d.events.append).toHaveBeenCalledWith(expect.objectContaining({ eventType: "step.log" }));
  });
});
