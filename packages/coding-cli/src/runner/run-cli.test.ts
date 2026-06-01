import { describe, it, expect } from "vitest";
import type { ICodingCLI } from "@journeyman/core";
import { runRunnerCli } from "./run-cli.ts";

function fakeProvider(): ICodingCLI {
  return {
    scanRepos: async () => ({ repos: [] }),
    checkoutRepo: async () => ({ repos: [], newBranch: "x" }),
    cleanupRepos: async () => ({ repos: [] }),
    createWorkspace: async () => ({ folderName: "f", repoDir: "/d" }),
    runCustomPrompt: async () => ({ structured: { ok: 1 } }),
  };
}

describe("runRunnerCli", () => {
  it("dispatches a valid request and returns a JSON response string", async () => {
    const out = await runRunnerCli(
      JSON.stringify({ op: "custom-prompt", opts: { prompt: "hi", outputMode: "structured" } }),
      fakeProvider(),
    );
    expect(JSON.parse(out)).toEqual({ ok: true, structured: { ok: 1 } });
  });

  it("returns ok:false on invalid JSON", async () => {
    const out = await runRunnerCli("{not json", fakeProvider());
    const parsed = JSON.parse(out);
    expect(parsed.ok).toBe(false);
    expect(parsed.error).toMatch(/invalid JSON/);
  });

  it("returns ok:false when op is missing", async () => {
    const out = await runRunnerCli(JSON.stringify({ opts: {} }), fakeProvider());
    expect(JSON.parse(out)).toEqual({ ok: false, error: "request must include a string 'op'" });
  });
});
