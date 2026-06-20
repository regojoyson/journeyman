import { describe, it, expect, vi } from "vitest";
import type { IDockerClient } from "./docker-client.ts";
import { DockerBackend } from "./docker-backend.ts";

const _built: string[] = [];
const fakeClient = {
  // Returns true once a tag has been "built" (mirrors real docker post-build).
  async imageExists(tag: string) { return _built.includes(tag); },
  async imageId() { return null; },
  async buildImage(o: { tag: string }) { _built.push(o.tag); },
} as unknown as IDockerClient;

const deps = { makeClient: () => fakeClient, defaultImage: "journeyman/runner-base:dev" };

function worker(config: unknown) {
  return { id: "w1", type: "docker" as const, executionMode: "per-instance" as const, config };
}

describe("DockerBackend", () => {
  it("declares docker / per-instance / push", () => {
    const b = new DockerBackend(deps);
    expect(b.type).toBe("docker");
    expect(b.supportedModes).toEqual(["per-instance"]);
    expect(b.supportedConnectivity).toEqual(["push"]);
  });

  it("validateConfig rejects a non-object", () => {
    expect(() => new DockerBackend(deps).validateConfig("nope")).toThrow();
  });

  it("validateConfig rejects an unknown image kind", () => {
    expect(() => new DockerBackend(deps).validateConfig({ image: { kind: "magic" } })).toThrow(/image/i);
  });

  it("create returns a DockerExecutionEnvironment", () => {
    const env = new DockerBackend(deps).create(worker({ image: { kind: "ref", imageRef: "x:1" } }));
    expect(env.type).toBe("docker");
  });
});

describe("DockerBackend.create builds a per-connection client", () => {
  it("calls makeClient with the worker connection", () => {
    const makeClient = vi.fn(() => fakeClient);
    new DockerBackend({ makeClient, defaultImage: "img:dev" }).create(
      worker({ connection: { host: "tcp://docker:2375" } }),
    );
    expect(makeClient).toHaveBeenCalledWith({ host: "tcp://docker:2375" });
  });
});

describe("DockerBackend.checkRunnable", () => {
  it("throws ImageNotReadyError when a recipe image is pending", async () => {
    const b = new DockerBackend(deps);
    const pending = { ...worker({ image: { kind: "dockerfile", content: "FROM x" } }), imageState: "pending" as const };
    await expect(Promise.resolve(b.checkRunnable!(pending))).rejects.toMatchObject({ name: "ImageNotReadyError" });
  });

  it("queues a build + throws ImageNotReadyError when imageState is none (never built)", async () => {
    const onImagePending = vi.fn(async () => {});
    const b = new DockerBackend({ makeClient: () => fakeClient, defaultImage: "img:dev", onImagePending });
    const never = { ...worker({ image: { kind: "ref", imageRef: "x:1" } }), imageState: "none" as const };
    await expect(Promise.resolve(b.checkRunnable!(never))).rejects.toMatchObject({ name: "ImageNotReadyError" });
    expect(onImagePending).toHaveBeenCalledWith("w1");
  });

  it("throws ConfigurationError when a recipe image build failed", async () => {
    const b = new DockerBackend(deps);
    const failed = { ...worker({ image: { kind: "ref", imageRef: "x:1" } }), imageState: "failed" as const, imageError: "boom" };
    await expect(Promise.resolve(b.checkRunnable!(failed))).rejects.toMatchObject({ name: "ConfigurationError" });
  });

  it("is a no-op when there is no image recipe", async () => {
    const b = new DockerBackend(deps);
    await expect(Promise.resolve(b.checkRunnable!(worker({})))).resolves.toBeUndefined();
  });

  it("re-enqueues + throws when a ready image was pruned (no imageRef)", async () => {
    const onImagePending = vi.fn(async () => {});
    const b = new DockerBackend({ makeClient: () => fakeClient, defaultImage: "img:dev", onImagePending });
    const pruned = { ...worker({ image: { kind: "ref", imageRef: "x:1" } }), imageState: "ready" as const, imageRef: null };
    await expect(Promise.resolve(b.checkRunnable!(pruned))).rejects.toMatchObject({ name: "ImageNotReadyError" });
    expect(onImagePending).toHaveBeenCalledWith("w1");
  });

  it("re-enqueues + throws when a ready image drifted (stale)", async () => {
    const onImagePending = vi.fn(async () => {});
    const verifyImageFresh = vi.fn(async () => ({ fresh: false, reason: "image drift" }));
    const b = new DockerBackend({ makeClient: () => fakeClient, defaultImage: "img:dev", onImagePending, verifyImageFresh });
    const stale = { ...worker({ image: { kind: "ref", imageRef: "x:1" } }), imageState: "ready" as const, imageRef: "built:fp", imageFingerprint: "fp" };
    await expect(Promise.resolve(b.checkRunnable!(stale))).rejects.toMatchObject({ name: "ImageNotReadyError" });
    expect(onImagePending).toHaveBeenCalledWith("w1");
  });

  it("passes for a ready+fresh image and stamps __imageRef", async () => {
    const verifyImageFresh = vi.fn(async () => ({ fresh: true }));
    const b = new DockerBackend({ makeClient: () => fakeClient, defaultImage: "img:dev", verifyImageFresh });
    const cfg = { image: { kind: "ref", imageRef: "x:1" } } as Record<string, unknown>;
    const ready = { ...worker(cfg), imageState: "ready" as const, imageRef: "built:abc" };
    await b.checkRunnable!(ready);
    expect(verifyImageFresh).toHaveBeenCalled();
    expect(cfg["__imageRef"]).toBe("built:abc");
  });

  it("forwards log callback to verifyImageFresh", async () => {
    const log = vi.fn();
    const verifyImageFresh = vi.fn(async () => ({ fresh: true }));
    const b = new DockerBackend({ makeClient: () => fakeClient, defaultImage: "img:dev", verifyImageFresh });
    const ready = {
      ...worker({ image: { kind: "ref", imageRef: "x:1" } }),
      imageState: "ready" as const,
      imageRef: "jm-built:abc",
      imageFingerprint: "fp1",
    };
    await b.checkRunnable!(ready, log);
    expect(verifyImageFresh).toHaveBeenCalledWith(expect.objectContaining({ log }));
  });
});
