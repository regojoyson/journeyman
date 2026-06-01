import { describe, it, expect } from "vitest";
import type { ExecResult, IExecutionEnvironment } from "@journeyman/core";

/**
 * Shared contract every IExecutionEnvironment backend must satisfy.
 * `makeEnv` must return an env whose `exec` echoes `{ op: <op.op> }` as structured output
 * (the local test wires an echo OperationRunner; the Docker test will bake an echo runner).
 */
export function runExecutionEnvironmentContract(
  name: string,
  makeEnv: () => Promise<IExecutionEnvironment> | IExecutionEnvironment,
): void {
  describe(`IExecutionEnvironment contract: ${name}`, () => {
    it("provision returns a handle with a non-empty workspaceDir", async () => {
      const env = await makeEnv();
      const p = await env.provision("run-1", {});
      expect(p.runId).toBe("run-1");
      expect(typeof p.workspaceDir).toBe("string");
      expect(p.workspaceDir.length).toBeGreaterThan(0);
      await env.destroy(p);
    });

    it("exec returns the operation result", async () => {
      const env = await makeEnv();
      const p = await env.provision("run-2", {});
      const r: ExecResult = await env.exec(p, { op: "echo", stdin: { hello: 1 } });
      expect(r.ok).toBe(true);
      expect(r.structured).toEqual({ op: "echo" });
      await env.destroy(p);
    });

    it("destroy is idempotent", async () => {
      const env = await makeEnv();
      const p = await env.provision("run-3", {});
      await env.destroy(p);
      await expect(env.destroy(p)).resolves.toBeUndefined();
    });
  });
}
