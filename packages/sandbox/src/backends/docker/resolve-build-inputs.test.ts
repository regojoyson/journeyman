import { describe, it, expect, vi } from "vitest";
import type { IDockerClient } from "./docker-client.ts";
import { resolveBuildInputs } from "./resolve-build-inputs.ts";

const BUNDLE = "journeyman/runner-bundle:dev";

function client(over: Partial<any> = {}) {
  return {
    imageId: vi.fn(async (tag: string) => (tag === BUNDLE ? "sha256:bundle" : "sha256:ref")),
    pullImage: vi.fn().mockResolvedValue(undefined),
    ...over,
  } as unknown as IDockerClient & { imageId: any; pullImage: any };
}

describe("resolveBuildInputs", () => {
  it("pulls a mutable ref and folds its id into the fingerprint", async () => {
    const c = client();
    const r = await resolveBuildInputs({ image: { kind: "ref", imageRef: "node:20" }, client: c, bundleRef: BUNDLE });
    expect(c.pullImage).toHaveBeenCalledWith("node:20");
    expect(r.baseRefId).toBe("sha256:ref");
    expect(r.imageRef).toMatch(/^journeyman\/jm-built:[0-9a-f]{16}$/);
    expect(r.dockerfilePull).toBe(false);
  });

  it("does NOT pull a digest-pinned ref, and does not fold its local id", async () => {
    const c = client();
    const r = await resolveBuildInputs({
      image: { kind: "ref", imageRef: "node@sha256:" + "a".repeat(64) },
      client: c, bundleRef: BUNDLE,
    });
    expect(c.pullImage).not.toHaveBeenCalled();
    // pinned base ref → digest already in the recipe FROM line, local id not folded
    expect(r.baseRefId).toBe("");
  });

  it("a digest-pinned bundle fingerprints the same whether or not its image is present (GC-safe)", async () => {
    const pinnedBundle = "localhost:5500/runner-bundle@sha256:" + "b".repeat(64);
    const image = { kind: "dockerfile" as const, content: "FROM node:22-bookworm" };
    // present: imageId returns an id; absent: imageId returns null (daemon GC'd the bundle)
    const present = await resolveBuildInputs({
      image, bundleRef: pinnedBundle,
      client: client({ imageId: vi.fn(async () => "sha256:localbundle") }),
    });
    const absent = await resolveBuildInputs({
      image, bundleRef: pinnedBundle,
      client: client({ imageId: vi.fn(async () => null) }),
    });
    expect(present.fingerprint).toBe(absent.fingerprint);
  });

  it("a MUTABLE bundle still folds its local id (a moved tag ⇒ a new fingerprint)", async () => {
    const image = { kind: "dockerfile" as const, content: "FROM node:22-bookworm" };
    const v1 = await resolveBuildInputs({
      image, bundleRef: "journeyman/runner-bundle:dev",
      client: client({ imageId: vi.fn(async () => "sha256:v1") }),
    });
    const v2 = await resolveBuildInputs({
      image, bundleRef: "journeyman/runner-bundle:dev",
      client: client({ imageId: vi.fn(async () => "sha256:v2") }),
    });
    expect(v1.fingerprint).not.toBe(v2.fingerprint);
  });

  it("falls back to the local image when the pull fails", async () => {
    const c = client({ pullImage: vi.fn().mockRejectedValue(new Error("offline")) });
    const r = await resolveBuildInputs({ image: { kind: "ref", imageRef: "node:20" }, client: c, bundleRef: BUNDLE });
    expect(r.baseRefId).toBe("sha256:ref"); // still resolved from local imageId
  });

  it("for a dockerfile recipe: no pull, empty baseRefId, dockerfilePull=true", async () => {
    const c = client();
    const r = await resolveBuildInputs({ image: { kind: "dockerfile", content: "FROM python:3.12\n" }, client: c, bundleRef: BUNDLE });
    expect(c.pullImage).not.toHaveBeenCalled();
    expect(r.baseRefId).toBe("");
    expect(r.dockerfilePull).toBe(true);
  });

  it("throws for an empty image", async () => {
    const c = client();
    await expect(resolveBuildInputs({ image: undefined, client: c, bundleRef: BUNDLE }))
      .rejects.toThrow(/no image recipe/i);
  });

  it("falls back to local copy when pull times out", async () => {
    // pullImage never resolves — simulates a hung registry
    const c = client({
      pullImage: vi.fn(() => new Promise<void>(() => {})),
    });
    const log = vi.fn();
    const r = await resolveBuildInputs({
      image: { kind: "ref", imageRef: "node:20" },
      client: c,
      bundleRef: BUNDLE,
      pullTimeoutMs: 10,          // expire almost immediately
      log,
    });
    // Despite the hung pull, we get a result using the locally-cached image id
    expect(r.baseRefId).toBe("sha256:ref");
    expect(r.imageRef).toMatch(/^journeyman\/jm-built:[0-9a-f]{16}$/);
    expect(log).toHaveBeenCalledWith(expect.stringContaining("pull timed out"));
  });
});
