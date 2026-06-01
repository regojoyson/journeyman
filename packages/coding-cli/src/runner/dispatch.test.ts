import { describe, it, expect } from "vitest";
import type { ICodingCLI } from "@journeyman/core";
import { dispatchOperation } from "./dispatch.ts";

function fakeProvider(over: Partial<ICodingCLI> = {}): ICodingCLI {
  return {
    scanRepos: async () => ({ repos: [] }),
    checkoutRepo: async () => ({ repos: [], newBranch: "x" }),
    cleanupRepos: async () => ({ repos: [] }),
    createWorkspace: async () => ({ folderName: "f", repoDir: "/d" }),
    runCustomPrompt: async () => ({ structured: { a: 1 } }),
    ...over,
  };
}

describe("dispatchOperation", () => {
  it("custom-prompt returns structured output", async () => {
    const r = await dispatchOperation(fakeProvider(), "custom-prompt", {
      prompt: "hi",
      outputMode: "structured",
    });
    expect(r).toEqual({ ok: true, structured: { a: 1 } });
  });

  it("custom-prompt error → ok:false", async () => {
    const r = await dispatchOperation(
      fakeProvider({ runCustomPrompt: async () => ({ error: "boom" }) }),
      "custom-prompt",
      {},
    );
    expect(r).toEqual({ ok: false, error: "boom" });
  });

  it("scan-repos returns the result as structured", async () => {
    const r = await dispatchOperation(
      fakeProvider({
        scanRepos: async () => ({ repos: [{ folderName: "a", repoDir: "/a", isGitRepo: true }] }),
      }),
      "scan-repos",
      { parentDir: "/x" },
    );
    expect(r.ok).toBe(true);
    expect(r.structured).toEqual({ repos: [{ folderName: "a", repoDir: "/a", isGitRepo: true }] });
  });

  it("git op error → ok:false", async () => {
    const r = await dispatchOperation(
      fakeProvider({ scanRepos: async () => ({ repos: [], error: "nope" }) }),
      "scan-repos",
      {},
    );
    expect(r).toEqual({ ok: false, error: "nope" });
  });

  it("unknown op → ok:false", async () => {
    const r = await dispatchOperation(fakeProvider(), "frobnicate", {});
    expect(r).toEqual({ ok: false, error: "unknown op 'frobnicate'" });
  });

  it("clone with no repoUrl returns an error (no git spawned)", async () => {
    const r = await dispatchOperation(fakeProvider(), "clone", {});
    expect(r).toEqual({ ok: false, error: "clone requires repoUrl" });
  });

  it("forwards cwd, onLog and signal to custom-prompt", async () => {
    const seen: Record<string, unknown> = {};
    const r = await dispatchOperation(
      fakeProvider({
        runCustomPrompt: async (o) => {
          seen.cwd = (o as { cwd?: string }).cwd;
          seen.hasLog = typeof o.onLog === "function";
          seen.hasSignal = Boolean(o.signal);
          return { structured: {} };
        },
      }),
      "custom-prompt",
      { cwd: "/ws" },
      { onLog: () => {}, signal: new AbortController().signal },
    );
    expect(r.ok).toBe(true);
    expect(seen).toEqual({ cwd: "/ws", hasLog: true, hasSignal: true });
  });
});
