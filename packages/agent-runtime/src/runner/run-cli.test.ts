import { describe, it, expect, vi } from "vitest";
import type { ICodingCLI } from "@journeyman/core";
import { runRunnerCli } from "./run-cli.ts";

function fakeProvider(): ICodingCLI {
  return {
    scanRepos: async () => ({ repos: [] }),
    checkoutRepo: async () => ({ repos: [], newBranch: "x" }),
    runCustomPrompt: async () => ({ structured: { ok: 1 } }),
  };
}

function makeProviderThunk(provider: ICodingCLI = fakeProvider()) {
  return () => provider;
}

describe("runRunnerCli", () => {
  it("dispatches a valid request and returns a JSON response string", async () => {
    const out = await runRunnerCli(
      JSON.stringify({ op: "custom-prompt", opts: { prompt: "hi", outputMode: "structured" } }),
      makeProviderThunk(),
    );
    expect(JSON.parse(out)).toEqual({ ok: true, structured: { ok: 1 } });
  });

  it("returns ok:false on invalid JSON", async () => {
    const out = await runRunnerCli("{not json", makeProviderThunk());
    const parsed = JSON.parse(out);
    expect(parsed.ok).toBe(false);
    expect(parsed.error).toMatch(/invalid JSON/);
  });

  it("returns ok:false when op is missing", async () => {
    const out = await runRunnerCli(JSON.stringify({ opts: {} }), makeProviderThunk());
    expect(JSON.parse(out)).toEqual({ ok: false, error: "request must include a string 'op'" });
  });

  it("passes req.provider key to the makeProvider factory", async () => {
    const factory = vi.fn().mockReturnValue(fakeProvider());
    const out = await runRunnerCli(
      JSON.stringify({ op: "custom-prompt", provider: "claude", opts: { prompt: "hi", outputMode: "structured" } }),
      factory,
    );
    expect(factory).toHaveBeenCalledWith("claude");
    expect(JSON.parse(out).ok).toBe(true);
  });

  it("passes undefined provider key when req.provider is absent", async () => {
    const factory = vi.fn().mockReturnValue(fakeProvider());
    await runRunnerCli(
      JSON.stringify({ op: "custom-prompt", opts: { prompt: "hi", outputMode: "structured" } }),
      factory,
    );
    expect(factory).toHaveBeenCalledWith(undefined);
  });
});
