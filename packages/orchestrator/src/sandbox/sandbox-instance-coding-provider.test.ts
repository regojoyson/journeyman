import { describe, it, expect, vi } from "vitest";
import type { ExecOp, ExecResult } from "@journeyman/core";
import { SandboxInstanceCodingProvider } from "./sandbox-instance-coding-provider.ts";

function execEnv(handler: (op: ExecOp) => ExecResult) {
  const calls: ExecOp[] = [];
  const exec = async (op: ExecOp): Promise<ExecResult> => {
    calls.push(op);
    return handler(op);
  };
  return { exec, calls };
}

describe("SandboxInstanceCodingProvider", () => {
  it("runCustomPrompt forwards to op 'custom-prompt' and maps structured output", async () => {
    const { exec, calls } = execEnv(() => ({ ok: true, structured: { hi: 1 } }));
    const p = new SandboxInstanceCodingProvider(exec);
    const r = await p.runCustomPrompt({ prompt: "x", outputMode: "structured", env: { K: "v" } });
    expect(r.structured).toEqual({ hi: 1 });
    expect(calls[0].op).toBe("custom-prompt");
    expect(calls[0].env).toEqual({ K: "v" });
    expect((calls[0].stdin as Record<string, unknown>).onLog).toBeUndefined();
    expect((calls[0].stdin as Record<string, unknown>).signal).toBeUndefined();
  });

  it("runCustomPrompt maps a string structured payload to a text result", async () => {
    const { exec } = execEnv(() => ({ ok: true, structured: "hello text" }));
    const p = new SandboxInstanceCodingProvider(exec);
    const r = await p.runCustomPrompt({ prompt: "x", outputMode: "text" });
    expect(r.result).toBe("hello text");
  });

  it("runCustomPrompt maps an error result", async () => {
    const { exec } = execEnv(() => ({ ok: false, error: "boom" }));
    const p = new SandboxInstanceCodingProvider(exec);
    const r = await p.runCustomPrompt({ prompt: "x", outputMode: "text" });
    expect(r.error).toBe("boom");
  });

  it("scanRepos forwards to op 'scan-repos' and returns structured as the result", async () => {
    const { exec, calls } = execEnv(() => ({ ok: true, structured: { repos: [] } }));
    const p = new SandboxInstanceCodingProvider(exec);
    const r = await p.scanRepos({ parentDir: "/workspace" });
    expect(r.repos).toEqual([]);
    expect(calls[0].op).toBe("scan-repos");
  });
});

describe("SandboxInstanceCodingProvider provider key", () => {
  it("includes the provider key on every ExecOp", async () => {
    const exec = vi.fn().mockResolvedValue({ ok: true, structured: { result: "ok" } });
    const p = new SandboxInstanceCodingProvider(exec, "claude");
    await p.runCustomPrompt({ prompt: "hi", outputMode: "text" } as any);
    expect(exec).toHaveBeenCalledWith(expect.objectContaining({ op: "custom-prompt", provider: "claude" }));
  });
});
