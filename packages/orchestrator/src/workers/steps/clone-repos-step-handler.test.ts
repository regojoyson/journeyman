import { describe, it, expect, vi } from "vitest";
import { CloneReposStepHandler } from "./clone-repos-step-handler.ts";
import type { IGitProvider, StepContext } from "@journeyman/core";

function makeCtx(): StepContext {
  return {
    workflowInstanceId: "wf", nodeId: "clone", attempt: 1,
    workspaceDir: "/workspace", signal: new AbortController().signal,
    env: {}, workflowInputs: {},
    log: vi.fn(),
  } as unknown as StepContext;
}

function makeHandler(
  cloneResult: Awaited<ReturnType<IGitProvider["cloneRepos"]>>,
) {
  return new CloneReposStepHandler({
    git: () => ({ cloneRepos: async () => cloneResult }) as unknown as IGitProvider,
  });
}

describe("CloneReposStepHandler", () => {
  it("calls ctx.log with ⚠ prefix when clone returns an error", async () => {
    const ctx = makeCtx();
    const handler = makeHandler({
      repos: [{ folderName: "repo", repoDir: "/workspace/repo", url: "https://github.com/owner/repo", branch: "", error: "clone aborted" }],
      error: "clone aborted",
    });
    const result = await handler.run({ repos: ["https://github.com/owner/repo"] }, ctx);
    expect(result.kind).toBe("failure");
    expect(ctx.log).toHaveBeenCalledWith("⚠ clone failed: clone aborted");
  });

  it("does not emit an error log on success", async () => {
    const ctx = makeCtx();
    const handler = makeHandler({
      repos: [{ folderName: "repo", repoDir: "/workspace/repo", url: "https://github.com/owner/repo", branch: "" }],
    });
    await handler.run({ repos: ["https://github.com/owner/repo"] }, ctx);
    const warnCalls = (ctx.log as ReturnType<typeof vi.fn>).mock.calls.filter(
      (c) => typeof c[0] === "string" && (c[0] as string).startsWith("⚠"),
    );
    expect(warnCalls).toHaveLength(0);
  });

  it("returns failure with CloneReposFailed errorClass", async () => {
    const ctx = makeCtx();
    const handler = makeHandler({ repos: [], error: "authentication failed" });
    const result = await handler.run({ repos: ["https://github.com/owner/repo"] }, ctx);
    if (result.kind !== "failure") throw new Error("expected failure");
    expect(result.failure.errorClass).toBe("CloneReposFailed");
    expect(result.failure.retryable).toBe(true);
  });
});
