import { describe, it, expect } from "vitest";
import { tmpdir } from "node:os";
import type { OperationRunner } from "@journeyman/core";
import type { DockerCommandRunner } from "./backends/docker/docker-command-runner.ts";
import { createDefaultRegistry } from "./default-registry.ts";

const runOperation: OperationRunner = async () => ({ ok: true });
const docker: DockerCommandRunner = async () => ({ stdout: "", stderr: "", exitCode: 0 });

describe("createDefaultRegistry", () => {
  it("always registers the local backend", () => {
    const r = createDefaultRegistry({ runOperation, defaultBaseDir: tmpdir() });
    expect(r.available()).toContain("local");
    expect(r.available()).not.toContain("docker");
  });

  it("registers docker when docker config is provided", () => {
    const r = createDefaultRegistry({
      runOperation,
      defaultBaseDir: tmpdir(),
      docker: { docker, defaultImage: "journeyman/runner-base:dev" },
    });
    expect(r.available()).toContain("local");
    expect(r.available()).toContain("docker");
    expect(r.get("docker").type).toBe("docker");
  });
});
