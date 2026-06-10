import { describe, it, expect, vi } from "vitest";

const runCustomPrompt = vi.fn();
vi.mock("./run-custom-prompt.ts", () => ({ runCustomPrompt: (o: unknown) => runCustomPrompt(o) }));

import { scanRepos } from "./scan-repos.ts";

describe("scanRepos (aisdk)", () => {
  it("drives a structured bash-only agent and maps the result", async () => {
    runCustomPrompt.mockResolvedValue({ sessionId: "s1", structured: { repos: [{ folderName: "a", repoDir: "/x/a", isGitRepo: true }] } });
    const r = await scanRepos({ parentDir: "/x", model: "anthropic-id" } as any);
    expect(r.sessionId).toBe("s1");
    expect(r.repos[0].folderName).toBe("a");
    const call = runCustomPrompt.mock.calls[0][0];
    expect(call.outputMode).toBe("structured");
    expect(call.tools).toEqual(["bash"]);
  });

  it("propagates errors as an empty repos result", async () => {
    runCustomPrompt.mockResolvedValue({ sessionId: "s2", error: "nope" });
    const r = await scanRepos({ parentDir: "/x" } as any);
    expect(r).toEqual({ repos: [], sessionId: "s2", error: "nope" });
  });
});
