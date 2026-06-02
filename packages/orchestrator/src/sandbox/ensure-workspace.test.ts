import { describe, it, expect, vi } from "vitest";
import { ensureWorkspace } from "./ensure-workspace.ts";

// Minimal fake ProvisionedEnv / IExecutionEnvironment for tests.
function fakeEnv(handle: string) {
  const provisioned = { runId: "r", type: "docker" as const, handle, workspaceDir: "/workspace" };
  const env = {} as any;
  return { env, provisioned };
}

describe("ensureWorkspace", () => {
  it("connects when an active sandbox already exists", async () => {
    const deps = {
      getSandbox: vi.fn().mockResolvedValue({
        runId: "r",
        type: "docker",
        status: "active",
        handle: "c1",
        connection: { kind: "local" },
        volume: "v",
      }),
      claim: vi.fn(),
      provisionDocker: vi.fn().mockResolvedValue(fakeEnv("c1")),
      provisionLocal: vi.fn(),
      markActive: vi.fn(),
      waitActive: vi.fn(),
      resolveWorker: vi.fn(),
    };
    const r = await ensureWorkspace(deps as any, {
      runId: "r",
      workerId: undefined,
      userId: "u",
      orgId: "o",
    });
    expect(r.provisioned.handle).toBe("c1");
    expect(deps.claim).not.toHaveBeenCalled();
  });

  it("waits when another worker is provisioning (existing row has provisioning status)", async () => {
    const deps = {
      getSandbox: vi.fn().mockResolvedValue({ runId: "r", type: "docker", status: "provisioning" }),
      claim: vi.fn().mockResolvedValue(false),
      waitActive: vi.fn().mockResolvedValue({ handle: "c2", volume: null, connection: null }),
      resolveWorker: vi.fn().mockResolvedValue({ type: "docker", config: {} }),
      provisionDocker: vi.fn().mockResolvedValue(fakeEnv("c2")),
      provisionLocal: vi.fn(),
      markActive: vi.fn(),
    };
    const r = await ensureWorkspace(deps as any, {
      runId: "r",
      workerId: undefined,
      userId: "u",
      orgId: "o",
    });
    expect(deps.waitActive).toHaveBeenCalled();
    expect(r.provisioned.handle).toBe("c2");
    // claim must NOT have been called — we noticed provisioning from getSandbox
    expect(deps.claim).not.toHaveBeenCalled();
  });

  it("waits when claim race is lost (no existing row but claim returns false)", async () => {
    const deps = {
      getSandbox: vi.fn().mockResolvedValue(null),
      claim: vi.fn().mockResolvedValue(false),
      waitActive: vi.fn().mockResolvedValue({ handle: "c3", volume: null, connection: null }),
      resolveWorker: vi.fn().mockResolvedValue({ type: "docker", config: {} }),
      provisionDocker: vi.fn().mockResolvedValue(fakeEnv("c3")),
      provisionLocal: vi.fn(),
      markActive: vi.fn(),
    };
    const r = await ensureWorkspace(deps as any, {
      runId: "r",
      workerId: undefined,
      userId: "u",
      orgId: "o",
    });
    expect(deps.waitActive).toHaveBeenCalled();
    expect(r.provisioned.handle).toBe("c3");
  });

  it("provisions docker when claim is won", async () => {
    const deps = {
      getSandbox: vi.fn().mockResolvedValue(null),
      claim: vi.fn().mockResolvedValue(true),
      waitActive: vi.fn(),
      resolveWorker: vi.fn().mockResolvedValue({ type: "docker", config: {} }),
      provisionDocker: vi.fn().mockResolvedValue({ ...fakeEnv("c4"), imageRef: "img:1", connection: { kind: "local" } }),
      provisionLocal: vi.fn(),
      markActive: vi.fn().mockResolvedValue(undefined),
    };
    const r = await ensureWorkspace(deps as any, {
      runId: "r",
      workerId: undefined,
      userId: "u",
      orgId: "o",
    });
    expect(deps.provisionDocker).toHaveBeenCalled();
    expect(deps.markActive).toHaveBeenCalledWith("r", expect.objectContaining({ handle: "c4" }));
    expect(r.provisioned.handle).toBe("c4");
    expect(deps.waitActive).not.toHaveBeenCalled();
  });

  it("provisions local when claim is won and worker type is local", async () => {
    const localProvisioned = { runId: "r", type: "local" as const, handle: "local:r", workspaceDir: "/tmp/ws/r" };
    const deps = {
      getSandbox: vi.fn().mockResolvedValue(null),
      claim: vi.fn().mockResolvedValue(true),
      waitActive: vi.fn(),
      resolveWorker: vi.fn().mockResolvedValue({ type: "local", config: {} }),
      provisionLocal: vi.fn().mockResolvedValue({ env: {}, provisioned: localProvisioned }),
      provisionDocker: vi.fn(),
      markActive: vi.fn().mockResolvedValue(undefined),
    };
    const r = await ensureWorkspace(deps as any, {
      runId: "r",
      workerId: undefined,
      userId: "u",
      orgId: "o",
    });
    expect(deps.provisionLocal).toHaveBeenCalledWith("r");
    expect(deps.markActive).toHaveBeenCalledWith("r", { handle: "local:r" });
    expect(r.provisioned.handle).toBe("local:r");
    expect(deps.provisionDocker).not.toHaveBeenCalled();
  });

  it("fails loud when user/org missing", async () => {
    const deps = { getSandbox: vi.fn().mockResolvedValue(null) } as any;
    await expect(
      ensureWorkspace(deps, { runId: "r", workerId: undefined, userId: null, orgId: null }),
    ).rejects.toThrow(/user\/org/i);
  });
});
