import { describe, it, expect } from "vitest";
import type { DockerCommandRunner } from "./docker-command-runner.ts";
import { buildDockerfileImage } from "./build-image.ts";

function recorder(inspectExit: number): { docker: DockerCommandRunner; calls: string[][] } {
  const calls: string[][] = [];
  const docker: DockerCommandRunner = async (args) => {
    calls.push(args);
    if (args[0] === "image" && args[1] === "inspect") return { stdout: "", stderr: "", exitCode: inspectExit };
    return { stdout: "", stderr: "", exitCode: 0 };
  };
  return { docker, calls };
}

describe("buildDockerfileImage", () => {
  it("returns the cached tag without building when the image already exists", async () => {
    const { docker, calls } = recorder(0); // inspect exit 0 ⇒ exists
    const ref = await buildDockerfileImage({ content: "FROM x", docker, bundleRef: "b:dev" });
    expect(ref).toMatch(/^journeyman\/jm-built:[0-9a-f]{16}$/);
    expect(calls.some((c) => c[0] === "build")).toBe(false);
  });

  it("builds and tags when the image is absent", async () => {
    const { docker, calls } = recorder(1); // inspect exit 1 ⇒ missing
    const ref = await buildDockerfileImage({ content: "FROM x", docker, bundleRef: "b:dev" });
    const build = calls.find((c) => c[0] === "build")!;
    expect(build).toContain("-t");
    expect(build).toContain(ref);
  });

  it("is deterministic: same content+bundle ⇒ same tag, different ⇒ different", async () => {
    const a = await buildDockerfileImage({ content: "FROM x", docker: recorder(0).docker, bundleRef: "b:dev" });
    const b = await buildDockerfileImage({ content: "FROM x", docker: recorder(0).docker, bundleRef: "b:dev" });
    expect(a).toBe(b);
    const c = await buildDockerfileImage({ content: "FROM y", docker: recorder(0).docker, bundleRef: "b:dev" });
    expect(c).not.toBe(a);
  });
});
