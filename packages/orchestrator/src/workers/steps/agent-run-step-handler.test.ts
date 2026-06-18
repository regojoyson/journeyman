import { describe, it, expect, vi } from "vitest";

vi.mock("@journeyman/connections", () => ({
  getConnection: vi.fn().mockResolvedValue({ provider: "github", baseUrl: undefined }),
  getConnectionSealed: vi
    .fn()
    .mockResolvedValue({ ciphertext: Buffer.from(""), iv: Buffer.from(""), authTag: Buffer.from("") }),
}));
vi.mock("@journeyman/secrets", () => ({ open: () => "tok_abc" }));

import { AgentRunStepHandler } from "./agent-run-step-handler.ts";

function ctx(over: Partial<any> = {}): any {
  return {
    workflowInstanceId: "wi1",
    nodeId: "n1",
    attempt: 1,
    workspaceDir: "/ws",
    signal: new AbortController().signal,
    env: {},
    workflowInputs: {},
    log: vi.fn(),
    ...over,
  };
}

describe("AgentRunStepHandler", () => {
  it("needsWorkspaceFor is true when repos are present", async () => {
    const h = new AgentRunStepHandler({ coding: vi.fn(), git: vi.fn(), pool: {} as any, bindingResolver: vi.fn() } as any);
    expect(await h.needsWorkspaceFor({ repos: ["acme/api"] } as any)).toBe(true);
    expect(await h.needsWorkspaceFor({ tools: ["bash"] } as any)).toBe(true);
    expect(await h.needsWorkspaceFor({ tools: [] } as any)).toBe(false);
  });

  it("clones repos then runs the prompt and returns text output", async () => {
    const cloneRepos = vi.fn().mockResolvedValue({ repos: [{ folderName: "api" }] });
    const runCustomPrompt = vi.fn().mockResolvedValue({ result: "done" });
    const h = new AgentRunStepHandler({
      coding: () => ({ runCustomPrompt }),
      git: () => ({ cloneRepos }),
      pool: {} as any,
      bindingResolver: vi.fn().mockResolvedValue({}),
    } as any);
    const res = await h.run(
      {
        instructions: "hi",
        provider: "claude",
        repos: ["acme/api"],
        tools: ["bash"],
        outputMode: "text",
        maxSteps: 40,
      } as any,
      ctx(),
    );
    expect(cloneRepos).toHaveBeenCalled();
    expect(runCustomPrompt).toHaveBeenCalledWith(expect.objectContaining({ prompt: "hi", maxSteps: 40 }));
    expect(res).toEqual({ kind: "success", output: { result: "done" } });
  });

  it("resolves a git connection token and injects it into the clone env", async () => {
    const cloneRepos = vi.fn().mockResolvedValue({ repos: [{ folderName: "api" }] });
    const runCustomPrompt = vi.fn().mockResolvedValue({ result: "done" });
    const gitFactory = vi.fn().mockReturnValue({ cloneRepos });
    const h = new AgentRunStepHandler({
      coding: () => ({ runCustomPrompt }),
      git: gitFactory,
      pool: {} as any,
      bindingResolver: vi.fn().mockResolvedValue({}),
    } as any);
    await h.run(
      {
        instructions: "hi",
        provider: "claude",
        repos: ["acme/api"],
        tools: ["bash"],
        outputMode: "text",
        gitConnectionId: "conn-1",
      } as any,
      ctx(),
    );
    expect(gitFactory).toHaveBeenCalledWith("github", expect.objectContaining({ GITHUB_ACCESS_TOKEN: "tok_abc" }));
  });

  it("fails (not retryable) when instructions are missing", async () => {
    const h = new AgentRunStepHandler({ coding: vi.fn(), git: vi.fn(), pool: {} as any, bindingResolver: vi.fn() } as any);
    const res = await h.run({ provider: "claude" } as any, ctx());
    expect(res.kind).toBe("failure");
  });
});
