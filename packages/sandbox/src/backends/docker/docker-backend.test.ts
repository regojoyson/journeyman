import { describe, it, expect } from "vitest";
import type { IDockerClient } from "./docker-client.ts";
import { DockerBackend } from "./docker-backend.ts";

const _built: string[] = [];
const fakeClient = {
  // Returns true once a tag has been "built" (mirrors real docker post-build).
  async imageExists(tag: string) { return _built.includes(tag); },
  async imageId() { return null; },
  async buildImage(o: { tag: string }) { _built.push(o.tag); },
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
