import { describe, it, expect, vi } from "vitest";
import { runBuildTick } from "./build-loop.ts";

const target = {
  id: "t1", name: "Python", imageFingerprint: null,
  config: { connection: { kind: "remote", host: "tcp://h:2376" },
    image: { kind: "ref", imageRef: "node:20" } },
} as any;

function deps(over: Partial<any> = {}) {
  return {
    db: { query: vi.fn() },
    bundleRef: "journeyman/runner-bundle:dev",
    leaseMs: 60_000,
    owner: "owner-1",
    claim: vi.fn().mockResolvedValue(target),
    makeClient: vi.fn().mockReturnValue({} as any),
    ensureKit: vi.fn().mockResolvedValue(undefined),
    build: vi.fn().mockResolvedValue({ imageRef: "journeyman/jm-built:fp", fingerprint: "fp" }),
    commit: vi.fn().mockResolvedValue(undefined),
    fail: vi.fn().mockResolvedValue(undefined),
    log: vi.fn(),
    ...over,
  };
}

describe("runBuildTick", () => {
  it("builds and commits a claimed target", async () => {
    const d = deps();
    const did = await runBuildTick(d as any);
    expect(did).toBe(true);
    expect(d.build).toHaveBeenCalledOnce();
    expect(d.commit).toHaveBeenCalledWith(d.db, "t1", "fp", "journeyman/jm-built:fp");
    expect(d.fail).not.toHaveBeenCalled();
  });

  it("records failure when the build throws", async () => {
    const d = deps({ build: vi.fn().mockRejectedValue(new Error("docker boom")) });
    const did = await runBuildTick(d as any);
    expect(did).toBe(true);
    expect(d.fail).toHaveBeenCalledWith(d.db, "t1", expect.any(String), expect.stringContaining("docker boom"));
  });

  it("returns false when nothing is claimable", async () => {
    const d = deps({ claim: vi.fn().mockResolvedValue(null) });
    expect(await runBuildTick(d as any)).toBe(false);
    expect(d.build).not.toHaveBeenCalled();
  });

  it("ensures the kit (pulls the bundle by digest) before building", async () => {
    const ensureKit = vi.fn().mockResolvedValue(undefined);
    const d = deps({ ensureKit });
    await runBuildTick(d as any);
    expect(ensureKit).toHaveBeenCalledWith(expect.anything(), "journeyman/runner-bundle:dev", undefined, expect.any(Function));
    expect(d.build).toHaveBeenCalledOnce();
  });

  it("resolves a function bundleRef live each tick (tracks a kit republish)", async () => {
    let current = "journeyman/runner-bundle:v1";
    const ensureKit = vi.fn().mockResolvedValue(undefined);
    const build = vi.fn().mockResolvedValue({ imageRef: "journeyman/jm-built:fp", fingerprint: "fp" });
    const d = deps({ bundleRef: () => current, ensureKit, build });

    await runBuildTick(d as any);
    expect(ensureKit).toHaveBeenCalledWith(expect.anything(), "journeyman/runner-bundle:v1", undefined, expect.any(Function));
    expect(build).toHaveBeenCalledWith(expect.objectContaining({ bundleRef: "journeyman/runner-bundle:v1" }));

    // Kit republished after the loop started — the next tick must pick up the new ref,
    // otherwise the builder and the freshness gate fingerprint different bundles forever.
    current = "journeyman/runner-bundle:v2";
    await runBuildTick(d as any);
    expect(ensureKit).toHaveBeenLastCalledWith(expect.anything(), "journeyman/runner-bundle:v2", undefined, expect.any(Function));
    expect(build).toHaveBeenLastCalledWith(expect.objectContaining({ bundleRef: "journeyman/runner-bundle:v2" }));
  });

  it("passes registry auth through to ensureKit when configured", async () => {
    const ensureKit = vi.fn().mockResolvedValue(undefined);
    const kitAuth = { username: "u", password: "p", serveraddress: "reg" };
    const d = deps({ ensureKit, kitAuth });
    await runBuildTick(d as any);
    expect(ensureKit).toHaveBeenCalledWith(expect.anything(), "journeyman/runner-bundle:dev", kitAuth, expect.any(Function));
  });
});
