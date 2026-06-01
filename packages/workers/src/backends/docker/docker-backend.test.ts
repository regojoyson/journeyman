import { describe, it, expect } from "vitest";
import type { IDockerClient } from "./docker-client.ts";
import { DockerBackend, resolveDockerSpec } from "./docker-backend.ts";

const fakeClient = {
  async imageExists() { return false; },
  async buildImage() { /* noop */ },
} as unknown as IDockerClient;

const deps = { client: fakeClient, defaultImage: "journeyman/runner-base:dev" };

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

describe("resolveDockerSpec", () => {
  it("uses a prebuilt ref directly (no build)", async () => {
    const built: string[] = [];
    const client = { async imageExists() { return false; }, async buildImage(o: { tag: string }) { built.push(o.tag); } } as unknown as IDockerClient;
    const spec = await resolveDockerSpec({ image: { kind: "ref", imageRef: "x:1" } }, { client, defaultImage: "d:1", bundleRef: "b:dev" });
    expect(spec.imageRef).toBe("x:1");
    expect(built).toEqual([]);
  });

  it("builds a dockerfile config to a jm-built ref", async () => {
    const spec = await resolveDockerSpec({ image: { kind: "dockerfile", content: "FROM x" } }, { client: fakeClient, defaultImage: "d:1", bundleRef: "b:dev" });
    expect(spec.imageRef).toMatch(/^journeyman\/jm-built:/);
  });

  it("falls back to the default image when no image is given", async () => {
    const spec = await resolveDockerSpec({}, { client: fakeClient, defaultImage: "d:1", bundleRef: "b:dev" });
    expect(spec.imageRef).toBe("d:1");
  });
});
