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
      getSandboxInstance: vi.fn().mockResolvedValue({
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
      resolveSandbox: vi.fn(),
    };
    const r = await ensureWorkspace(deps as any, {
      runId: "r",
      sandboxId: undefined,
      userId: "u",
      orgId: "o",
    });
    expect(r.provisioned.handle).toBe("c1");
    expect(deps.claim).not.toHaveBeenCalled();
  });

  it("waits when another worker is provisioning (existing row has provisioning status)", async () => {
    const deps = {
      getSandboxInstance: vi.fn().mockResolvedValue({ runId: "r", type: "docker", status: "provisioning" }),
      claim: vi.fn().mockResolvedValue(false),
      waitActive: vi.fn().mockResolvedValue({ handle: "c2", volume: null, connection: null }),
      resolveSandbox: vi.fn().mockResolvedValue({ type: "docker", config: {} }),
      provisionDocker: vi.fn().mockResolvedValue(fakeEnv("c2")),
      provisionLocal: vi.fn(),
      markActive: vi.fn(),
    };
    const r = await ensureWorkspace(deps as any, {
      runId: "r",
      sandboxId: undefined,
      userId: "u",
      orgId: "o",
    });
    expect(deps.waitActive).toHaveBeenCalled();
    expect(r.provisioned.handle).toBe("c2");
    // claim must NOT have been called — we noticed provisioning from getSandboxInstance
    expect(deps.claim).not.toHaveBeenCalled();
  });

  it("waits when claim race is lost (no existing row but claim returns false)", async () => {
    const deps = {
      getSandboxInstance: vi.fn().mockResolvedValue(null),
      claim: vi.fn().mockResolvedValue(false),
      waitActive: vi.fn().mockResolvedValue({ handle: "c3", volume: null, connection: null }),
      resolveSandbox: vi.fn().mockResolvedValue({ type: "docker", config: {} }),
      provisionDocker: vi.fn().mockResolvedValue(fakeEnv("c3")),
      provisionLocal: vi.fn(),
      markActive: vi.fn(),
    };
    const r = await ensureWorkspace(deps as any, {
      runId: "r",
      sandboxId: undefined,
      userId: "u",
      orgId: "o",
    });
    expect(deps.waitActive).toHaveBeenCalled();
    expect(r.provisioned.handle).toBe("c3");
  });

  it("provisions docker when claim is won", async () => {
    const deps = {
      getSandboxInstance: vi.fn().mockResolvedValue(null),
      claim: vi.fn().mockResolvedValue(true),
      waitActive: vi.fn(),
      resolveSandbox: vi.fn().mockResolvedValue({ type: "docker", config: {} }),
      provisionDocker: vi.fn().mockResolvedValue({ ...fakeEnv("c4"), imageRef: "img:1", connection: { kind: "local" } }),
      provisionLocal: vi.fn(),
      markActive: vi.fn().mockResolvedValue(undefined),
    };
    const r = await ensureWorkspace(deps as any, {
      runId: "r",
      sandboxId: undefined,
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
      getSandboxInstance: vi.fn().mockResolvedValue(null),
      claim: vi.fn().mockResolvedValue(true),
      waitActive: vi.fn(),
      resolveSandbox: vi.fn().mockResolvedValue({ type: "local", config: {} }),
      provisionLocal: vi.fn().mockResolvedValue({ env: {}, provisioned: localProvisioned }),
      provisionDocker: vi.fn(),
      markActive: vi.fn().mockResolvedValue(undefined),
    };
    const r = await ensureWorkspace(deps as any, {
      runId: "r",
      sandboxId: undefined,
      userId: "u",
      orgId: "o",
    });
    expect(deps.provisionLocal).toHaveBeenCalledWith("r");
    expect(deps.markActive).toHaveBeenCalledWith("r", { handle: "local:r" });
    expect(r.provisioned.handle).toBe("local:r");
    expect(deps.provisionDocker).not.toHaveBeenCalled();
  });

  it("fails loud when user/org missing", async () => {
    const deps = { getSandboxInstance: vi.fn().mockResolvedValue(null) } as any;
    await expect(
      ensureWorkspace(deps, { runId: "r", sandboxId: undefined, userId: null, orgId: null }),
    ).rejects.toThrow(/user\/org/i);
  });

  it("emits lifecycle logs on the docker provision (won) path", async () => {
    const lines: string[] = [];
    const deps = {
      getSandboxInstance: vi.fn().mockResolvedValue(null),
      claim: vi.fn().mockResolvedValue(true),
      markActive: vi.fn().mockResolvedValue(undefined),
      waitActive: vi.fn(),
      resolveSandbox: vi.fn().mockResolvedValue({ type: "docker", config: {} }),
      provisionDocker: vi.fn().mockResolvedValue({ ...fakeEnv("c1"), imageRef: "img:dev" }),
      provisionLocal: vi.fn(),
    };
    await ensureWorkspace(deps as any, {
      runId: "r", sandboxId: "w", userId: "u", orgId: "o", log: (l: string) => lines.push(l),
    });
    expect(lines.some((l) => /provisioning docker workspace/i.test(l))).toBe(true);
    expect(lines.some((l) => /workspace ready/i.test(l))).toBe(true);
  });

  it("emits 'using existing workspace' on the connect path", async () => {
    const lines: string[] = [];
    const deps = {
      getSandboxInstance: vi.fn().mockResolvedValue({ runId: "r", type: "docker", status: "active", handle: "c1", connection: { kind: "local" } }),
      provisionDocker: vi.fn().mockResolvedValue(fakeEnv("c1")),
      claim: vi.fn(), provisionLocal: vi.fn(), markActive: vi.fn(), waitActive: vi.fn(), resolveSandbox: vi.fn(),
    };
    await ensureWorkspace(deps as any, {
      runId: "r", sandboxId: "w", userId: "u", orgId: "o", log: (l: string) => lines.push(l),
    });
    expect(lines.some((l) => /using existing workspace/i.test(l))).toBe(true);
  });

  it("logs a failure line when provisioning throws", async () => {
    const lines: string[] = [];
    const deps = {
      getSandboxInstance: vi.fn().mockResolvedValue(null),
      claim: vi.fn().mockResolvedValue(true),
      resolveSandbox: vi.fn().mockResolvedValue({ type: "docker", config: {} }),
      provisionDocker: vi.fn().mockRejectedValue(new Error("daemon down")),
      provisionLocal: vi.fn(), markActive: vi.fn(), waitActive: vi.fn(),
    };
    await expect(
      ensureWorkspace(deps as any, {
        runId: "r", sandboxId: "w", userId: "u", orgId: "o", log: (l: string) => lines.push(l),
      }),
    ).rejects.toThrow(/daemon down/);
    expect(lines.some((l) => /provisioning failed/i.test(l))).toBe(true);
  });
});

describe("ensureWorkspace run-gating (Spec B managed images)", () => {
  function baseDeps(target: any, over: Partial<any> = {}) {
    return {
      getSandboxInstance: vi.fn().mockResolvedValue(null),
      claim: vi.fn().mockResolvedValue(true),
      markActive: vi.fn().mockResolvedValue(undefined),
      waitActive: vi.fn(),
      resolveSandbox: vi.fn().mockResolvedValue(target),
      provisionLocal: vi.fn(),
      provisionDocker: vi.fn().mockResolvedValue({
        env: {}, provisioned: { handle: "h", workspaceDir: "/workspace", type: "docker" },
        imageRef: "journeyman/jm-built:fp", connection: {},
      }),
      onImagePending: vi.fn(),
      ...over,
    };
  }
  const args = { runId: "r1", sandboxId: "t1", userId: "u", orgId: "o" };

  it("provisions a ready docker image with its imageRef", async () => {
    const deps = baseDeps({ type: "docker", config: { image: { kind: "ref", imageRef: "node:20" } },
      imageState: "ready", imageRef: "journeyman/jm-built:fp" });
    await ensureWorkspace(deps as any, args);
    expect(deps.provisionDocker).toHaveBeenCalledWith("r1",
      expect.objectContaining({ config: expect.objectContaining({ __imageRef: "journeyman/jm-built:fp" }) }));
  });

  it("throws a RETRYABLE error while building", async () => {
    const deps = baseDeps({ type: "docker", config: { image: { kind: "ref", imageRef: "node:20" } },
      imageState: "building", imageRef: null });
    await expect(ensureWorkspace(deps as any, args)).rejects.toMatchObject({ name: "ImageNotReadyError" });
    expect(deps.provisionDocker).not.toHaveBeenCalled();
  });

  it("throws a TERMINAL ConfigurationError when the build failed", async () => {
    const deps = baseDeps({ type: "docker", config: { image: { kind: "ref", imageRef: "node:20" } },
      imageState: "failed", imageRef: null, imageError: "bad Dockerfile" });
    await expect(ensureWorkspace(deps as any, args))
      .rejects.toMatchObject({ name: "ConfigurationError", message: expect.stringContaining("bad Dockerfile") });
  });

  it("re-enqueues + retries when a ready image was pruned (no imageRef)", async () => {
    const deps = baseDeps({ type: "docker", config: { image: { kind: "ref", imageRef: "node:20" } },
      imageState: "ready", imageRef: null });
    await expect(ensureWorkspace(deps as any, args)).rejects.toMatchObject({ name: "ImageNotReadyError" });
    expect(deps.onImagePending).toHaveBeenCalledWith("t1");
  });

  it("provisions the default box for an empty image", async () => {
    const deps = baseDeps({ type: "docker", config: {}, imageState: "none", imageRef: null });
    await ensureWorkspace(deps as any, args);
    expect(deps.provisionDocker).toHaveBeenCalledOnce();
  });
});
