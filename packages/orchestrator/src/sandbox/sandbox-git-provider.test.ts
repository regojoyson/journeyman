import { describe, it, expect } from "vitest";
import type { ExecOp, ExecResult } from "@journeyman/core";
import { SandboxGitProvider } from "./sandbox-git-provider.ts";

describe("SandboxGitProvider", () => {
  it("cloneRepos forwards each repo to op 'clone' and aggregates results", async () => {
    const ops: ExecOp[] = [];
    const exec = async (op: ExecOp): Promise<ExecResult> => { ops.push(op); return { ok: true, structured: { dir: "x" } }; };
    const p = new SandboxGitProvider(exec);
    const res = await p.cloneRepos({ repos: "https://git/x.git", workspaceDir: "/workspace", branch: "main" });
    expect(res.error).toBeUndefined();
    expect(res.repos[0].repoDir).toBe("/workspace/x");
    expect(res.repos[0].branch).toBe("main");
    expect(ops[0].op).toBe("clone");
    expect((ops[0].stdin as Record<string, unknown>).repoUrl).toBe("https://git/x.git");
  });

  it("cloneRepos returns an error when a clone fails", async () => {
    const exec = async (): Promise<ExecResult> => ({ ok: false, error: "auth failed" });
    const p = new SandboxGitProvider(exec);
    const res = await p.cloneRepos({ repos: ["https://git/x.git"], workspaceDir: "/workspace" });
    expect(res.error).toMatch(/auth failed/);
    expect(res.repos[0].error).toMatch(/auth failed/);
  });
});
