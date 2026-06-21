import { describe, it, expect, vi } from "vitest";
import { ensureWorkspace } from "./ensure-workspace.ts";
import type { IExecutionEnvironmentRegistry, ProvisionedEnv } from "@journeyman/core";

/** A fake registry whose backend.create() returns an env with a controllable provision result. */
function fakeRegistry(opts: {
  checkRunnable?: () => Promise<void>;
  provision?: (runId: string) => ProvisionedEnv;
} = {}) {
  const provision = vi.fn(async (runId: string) =>
    opts.provision
      ? opts.provision(runId)
      : ({ runId, type: "docker", handle: `prov-${runId}`, workspaceDir: "/workspace" } as ProvisionedEnv),
  );
  const env = { provision, destroy: vi.fn(), exec: vi.fn(), list: vi.fn(), materialize: vi.fn() };
  const create = vi.fn(() => env);
  const backend = { create, ...(opts.checkRunnable ? { checkRunnable: vi.fn(opts.checkRunnable) } : {}) };
  const registry = { get: vi.fn(() => backend), register: vi.fn(), available: vi.fn(() => []) } as unknown as IExecutionEnvironmentRegistry;
  return { registry, backend, env, create, provision };
}

function baseDeps(registry: IExecutionEnvironmentRegistry, over: Record<string, unknown> = {}) {
  return {
    getSandboxInstance: vi.fn().mockResolvedValue(null),
    claim: vi.fn().mockResolvedValue(true),
    releaseClaim: vi.fn().mockResolvedValue(undefined),
    markActive: vi.fn().mockResolvedValue(undefined),
    waitActive: vi.fn(),
    resolveSandbox: vi.fn().mockResolvedValue({ id: "w1", type: "docker", config: { connection: { host: "tcp://docker:2375" } } }),
    registry,
    ...over,
  };
}
const args = { runId: "r", sandboxId: "w1", userId: "u", orgId: "o" };

describe("ensureWorkspace (registry-driven)", () => {
  it("connects via the registry when an active sandbox already exists (no claim)", async () => {
    const { registry, create } = fakeRegistry();
    const deps = baseDeps(registry, {
      getSandboxInstance: vi.fn().mockResolvedValue({ runId: "r", type: "docker", status: "active", handle: "c1", connection: {}, volume: "v" }),
    });
    const r = await ensureWorkspace(deps as never, args);
    expect(r.provisioned.handle).toBe("prov-r");
    expect(deps.claim).not.toHaveBeenCalled();
    expect(create).toHaveBeenCalled();
  });

  it("waits when another worker is provisioning", async () => {
    const { registry } = fakeRegistry();
    const deps = baseDeps(registry, {
      getSandboxInstance: vi.fn().mockResolvedValue({ runId: "r", type: "docker", status: "provisioning" }),
      waitActive: vi.fn().mockResolvedValue({ handle: "c2", volume: null, connection: null }),
    });
    await ensureWorkspace(deps as never, args);
    expect(deps.waitActive).toHaveBeenCalled();
    expect(deps.claim).not.toHaveBeenCalled();
  });

  it("waits when the claim race is lost", async () => {
    const { registry } = fakeRegistry();
    const deps = baseDeps(registry, {
      claim: vi.fn().mockResolvedValue(false),
      waitActive: vi.fn().mockResolvedValue({ handle: "c3", volume: null, connection: null }),
    });
    await ensureWorkspace(deps as never, args);
    expect(deps.waitActive).toHaveBeenCalled();
  });

  it("provisions via the registry when claim is won and marks active", async () => {
    const { registry } = fakeRegistry({
      provision: (runId) => ({ runId, type: "docker", handle: "c4", volume: "v4", workspaceDir: "/workspace", imageRef: "img:1" }),
    });
    const deps = baseDeps(registry);
    const r = await ensureWorkspace(deps as never, args);
    expect(r.provisioned.handle).toBe("c4");
    expect(deps.markActive).toHaveBeenCalledWith("r", expect.objectContaining({
      handle: "c4", imageRef: "img:1", connection: { host: "tcp://docker:2375" },
    }));
    expect(deps.waitActive).not.toHaveBeenCalled();
  });

  it("provisions a local worker via the registry", async () => {
    const { registry } = fakeRegistry({
      provision: (runId) => ({ runId, type: "local", handle: `local:${runId}`, workspaceDir: `/tmp/${runId}` }),
    });
    const deps = baseDeps(registry, {
      resolveSandbox: vi.fn().mockResolvedValue({ id: "w1", type: "local", config: {} }),
    });
    const r = await ensureWorkspace(deps as never, args);
    expect(r.provisioned.handle).toBe("local:r");
    expect(deps.markActive).toHaveBeenCalledWith("r", expect.objectContaining({ handle: "local:r" }));
  });

  it("calls checkRunnable before claim and propagates a not-ready throw", async () => {
    const err = Object.assign(new Error("not ready"), { name: "ImageNotReadyError" });
    const { registry, backend } = fakeRegistry({ checkRunnable: async () => { throw err; } });
    const deps = baseDeps(registry, {
      resolveSandbox: vi.fn().mockResolvedValue({ id: "w1", type: "docker", config: {}, imageState: "pending" }),
    });
    await expect(ensureWorkspace(deps as never, args)).rejects.toMatchObject({ name: "ImageNotReadyError" });
    expect(backend.checkRunnable).toHaveBeenCalled();
    expect(deps.claim).not.toHaveBeenCalled();
  });

  it("fails loud when user/org missing", async () => {
    const { registry } = fakeRegistry();
    const deps = baseDeps(registry);
    await expect(
      ensureWorkspace(deps as never, { runId: "r", sandboxId: undefined, userId: null, orgId: null }),
    ).rejects.toThrow(/user\/org/i);
  });

  it("emits lifecycle logs on the provision path", async () => {
    const lines: string[] = [];
    const { registry } = fakeRegistry();
    const deps = baseDeps(registry);
    await ensureWorkspace(deps as never, { ...args, log: (l: string) => lines.push(l) });
    expect(lines.some((l) => /provisioning docker workspace/i.test(l))).toBe(true);
    expect(lines.some((l) => /workspace ready/i.test(l))).toBe(true);
  });

  it("logs a failure line when provisioning throws", async () => {
    const lines: string[] = [];
    const { registry, env } = fakeRegistry();
    env.provision = vi.fn().mockRejectedValue(new Error("daemon down"));
    const deps = baseDeps(registry);
    await expect(
      ensureWorkspace(deps as never, { ...args, log: (l: string) => lines.push(l) }),
    ).rejects.toThrow(/daemon down/);
    expect(lines.some((l) => /provisioning failed/i.test(l))).toBe(true);
  });

  it("passes sandboxId and limit to claim", async () => {
    const { registry } = fakeRegistry();
    const deps = baseDeps(registry, {
      resolveSandbox: vi.fn().mockResolvedValue({ id: "w1", type: "docker", config: {}, maxConcurrentInstances: 3 }),
    });
    await ensureWorkspace(deps as never, args);
    expect(deps.claim).toHaveBeenCalledWith(
      expect.objectContaining({ runId: "r", sandboxId: "w1", limit: 3 }),
    );
  });

  it("propagates SandboxAtCapacityError from claim", async () => {
    const { registry } = fakeRegistry();
    const err = Object.assign(new Error("full"), { name: "SandboxAtCapacityError" });
    const deps = baseDeps(registry, { claim: vi.fn().mockRejectedValue(err) });
    await expect(ensureWorkspace(deps as never, args)).rejects.toMatchObject({ name: "SandboxAtCapacityError" });
  });

  it("releases the claim when provision() fails", async () => {
    const { registry, env } = fakeRegistry();
    env.provision = vi.fn().mockRejectedValue(new Error("boom"));
    const deps = baseDeps(registry, {});
    await expect(ensureWorkspace(deps as never, args)).rejects.toThrow("boom");
    expect(deps.releaseClaim).toHaveBeenCalledWith("r");
  });
});
