import { describe, it, expect } from "vitest";
import type { ICodingCLI } from "@journeyman/core";
import { createCodingOperationRunner } from "./operation-runner.ts";

function fakeProvider(): ICodingCLI {
  return {
    scanRepos: async () => ({ repos: [] }),
    checkoutRepo: async () => ({ repos: [], newBranch: "x" }),
    cleanupRepos: async () => ({ repos: [] }),
    createWorkspace: async () => ({ folderName: "f", repoDir: "/d" }),
    runCustomPrompt: async (o) => ({ structured: { cwd: (o as { cwd?: string }).cwd } }),
  };
}

describe("createCodingOperationRunner", () => {
  it("maps ExecOp to dispatch, injecting workspaceDir as cwd and passing env to the provider factory", async () => {
    const envs: Array<Record<string, string>> = [];
    const run = createCodingOperationRunner({
      makeProvider: (env) => {
        envs.push(env);
        return fakeProvider();
      },
    });
    const res = await run(
      { op: "custom-prompt", stdin: { prompt: "hi", outputMode: "structured" }, env: { ANTHROPIC_API_KEY: "k" } },
      { workspaceDir: "/ws" },
    );
    expect(res).toEqual({ ok: true, structured: { cwd: "/ws" } });
    expect(envs).toEqual([{ ANTHROPIC_API_KEY: "k" }]);
  });

  it("returns an error ExecResult on unknown op", async () => {
    const run = createCodingOperationRunner({ makeProvider: () => fakeProvider() });
    const res = await run({ op: "nope", stdin: {} }, { workspaceDir: "/ws" });
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/unknown op/);
  });
});
