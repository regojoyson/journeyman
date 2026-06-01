import { describe, it, expect } from "vitest";
import type { DockerCommandRunner } from "./docker-command-runner.ts";
import { DockerBackend, dockerSpecFromConfig } from "./docker-backend.ts";

const noopDocker: DockerCommandRunner = async () => ({ stdout: "", stderr: "", exitCode: 0 });
const deps = { docker: noopDocker, defaultImage: "journeyman/runner-base:dev" };

function worker(config: unknown) {
  return { id: "w1", type: "docker" as const, executionMode: "per-instance" as const, config };
}

describe("dockerSpecFromConfig", () => {
  it("maps an image-ref config to a spec", () => {
    const spec = dockerSpecFromConfig(
      { image: { kind: "ref", imageRef: "x:1" }, network: "none", resources: { cpus: 2 } },
      "default:img",
    );
    expect(spec.imageRef).toBe("x:1");
    expect(spec.network).toBe("none");
    expect(spec.resources).toEqual({ cpus: 2 });
  });

  it("falls back to the default image when none given", () => {
    const spec = dockerSpecFromConfig({}, "default:img");
    expect(spec.imageRef).toBe("default:img");
  });

  it("throws for a dockerfile image (not supported until Plan 5)", () => {
    expect(() => dockerSpecFromConfig({ image: { kind: "dockerfile", content: "FROM x" } }, "d"))
      .toThrow(/dockerfile/i);
  });
});

describe("DockerBackend", () => {
  it("declares docker / per-instance / push", () => {
    const b = new DockerBackend(deps);
    expect(b.type).toBe("docker");
    expect(b.supportedModes).toEqual(["per-instance"]);
    expect(b.supportedConnectivity).toEqual(["push"]);
  });

  it("validateConfig rejects a non-object", () => {
    const b = new DockerBackend(deps);
    expect(() => b.validateConfig("nope")).toThrow();
  });

  it("validateConfig rejects an unknown image kind", () => {
    const b = new DockerBackend(deps);
    expect(() => b.validateConfig({ image: { kind: "magic" } })).toThrow(/image/i);
  });

  it("create returns a DockerExecutionEnvironment", async () => {
    const b = new DockerBackend(deps);
    const env = b.create(worker({ image: { kind: "ref", imageRef: "x:1" } }));
    expect(env.type).toBe("docker");
  });
});
