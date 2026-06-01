import { describe, it, expect } from "vitest";
import { makeProcessCommandRunner } from "./docker-command-runner.ts";
import { DockerExecutionEnvironment } from "./docker-execution-environment.ts";

const RUN_IT = process.env.JM_DOCKER_IT === "1";
const IMAGE = process.env.JM_RUNNER_IMAGE ?? "journeyman/runner-base:dev";

describe.skipIf(!RUN_IT)("DockerExecutionEnvironment (real docker)", () => {
  it("provisions, execs the runner (unknown op), and destroys", async () => {
    const env = new DockerExecutionEnvironment({ docker: makeProcessCommandRunner("docker"), defaultImage: IMAGE });
    const runId = `it-${Date.now()}`;
    const p = await env.provision(runId, { imageRef: IMAGE });
    try {
      expect(p.handle.length).toBeGreaterThan(0);
      const res = await env.exec(p, { op: "definitely-not-a-real-op", stdin: {} });
      expect(res.ok).toBe(false);
      expect(res.error).toMatch(/unknown op/);
    } finally {
      await env.destroy(p);
    }
  }, 120_000);
});
