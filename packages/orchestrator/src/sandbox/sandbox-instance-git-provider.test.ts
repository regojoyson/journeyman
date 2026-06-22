import { describe, it, expect } from "vitest";
import type { ExecOp, ExecResult } from "@journeyman/core";
import { SandboxInstanceGitProvider } from "./sandbox-instance-git-provider.ts";

describe("SandboxInstanceGitProvider", () => {
  it("sends each repo's own branch in the clone op stdin", async () => {
    const calls: ExecOp[] = [];
    const exec = async (op: ExecOp): Promise<ExecResult> => { calls.push(op); return { ok: true }; };
    const provider = new SandboxInstanceGitProvider(exec);
    await provider.cloneRepos({
      repos: [{ url: "acme/api", branch: "develop" }, { url: "acme/web", branch: "" }],
      workspaceDir: "/workspace",
    });
    expect(calls).toHaveLength(2);
    expect(calls[0].stdin).toMatchObject({ dir: "api", branch: "develop" });
    expect((calls[1].stdin as { branch?: string }).branch).toBeUndefined();
    expect((calls[1].stdin as { dir?: string }).dir).toBe("web");
  });

  it("cloneRepos forwards each repo to op 'clone' and aggregates results", async () => {
    const ops: ExecOp[] = [];
    const exec = async (op: ExecOp): Promise<ExecResult> => { ops.push(op); return { ok: true, structured: { dir: "x" } }; };
    const p = new SandboxInstanceGitProvider(exec);
    const res = await p.cloneRepos({ repos: "https://git/x.git", workspaceDir: "/workspace", branch: "main" });
    expect(res.error).toBeUndefined();
    expect(res.repos[0].repoDir).toBe("/workspace/x");
    expect(res.repos[0].branch).toBe("main");
    expect(ops[0].op).toBe("clone");
    expect((ops[0].stdin as Record<string, unknown>).repoUrl).toBe("https://git/x.git");
  });

  it("forwards onLog on the clone ExecOp", async () => {
    const ops: ExecOp[] = [];
    const exec = async (op: ExecOp): Promise<ExecResult> => { ops.push(op); return { ok: true }; };
    const onLog = () => {};
    await new SandboxInstanceGitProvider(exec).cloneRepos({ repos: "https://git/x.git", onLog });
    expect(ops[0].onLog).toBe(onLog);
  });

  it("cloneRepos returns an error when a clone fails", async () => {
    const exec = async (): Promise<ExecResult> => ({ ok: false, error: "auth failed" });
    const p = new SandboxInstanceGitProvider(exec);
    const res = await p.cloneRepos({ repos: ["https://git/x.git"], workspaceDir: "/workspace" });
    expect(res.error).toMatch(/auth failed/);
    expect(res.repos[0].error).toMatch(/auth failed/);
  });
});
