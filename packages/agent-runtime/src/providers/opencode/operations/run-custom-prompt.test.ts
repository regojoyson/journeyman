import { describe, it, expect, vi } from "vitest";
import { runCustomPrompt } from "./run-custom-prompt.ts";
import type { OpenCodeClient } from "../client.ts";
import type { OpenCodeProviderConfig } from "../types.ts";

const cfg: OpenCodeProviderConfig = { mode: "managed", model: { providerID: "anthropic", modelID: "x" } };

function fakeClient(promptImpl: (params: any) => any): OpenCodeClient {
  return {
    session: {
      create: vi.fn().mockResolvedValue({ data: { id: "sess-1" } }),
      prompt: vi.fn().mockImplementation(async (p: any) => promptImpl(p)),
    },
  } as unknown as OpenCodeClient;
}

function fakeClientWithAbort(
  promptImpl: (params: any) => any,
  abort: ReturnType<typeof vi.fn>,
): OpenCodeClient {
  return {
    session: {
      create: vi.fn().mockResolvedValue({ data: { id: "sess-1" } }),
      prompt: vi.fn().mockImplementation(async (p: any) => promptImpl(p)),
      abort,
    },
  } as unknown as OpenCodeClient;
}

describe("opencode runCustomPrompt", () => {
  it("structured mode passes the schema and returns info.structured", async () => {
    let captured: any;
    const client = fakeClient((p) => { captured = p; return { data: { info: { structured: { ok: true } }, parts: [] } }; });
    const r = await runCustomPrompt(client, cfg, {
      prompt: "do it", outputMode: "structured", outputSchema: { type: "object" },
      model: "openai/gpt-4o", tools: ["bash", "search"], cwd: "/workspace",
    });
    expect(captured.model).toEqual({ providerID: "openai", modelID: "gpt-4o" });
    // Explicit enable/disable map: selected tools true, the rest of the builtins false.
    expect(captured.tools).toEqual({
      bash: true, grep: true, glob: true, read: false, write: false, edit: false, webfetch: false,
    });
    expect(captured.directory).toBe("/workspace");
    expect(captured.format.type).toBe("json_schema");
    expect(captured.format.schema).toEqual({ type: "object" });
    expect(typeof captured.format.retryCount).toBe("number");
    expect(r.structured).toEqual({ ok: true });
    expect(r.error).toBeUndefined();
  });

  it("structured mode without a schema returns an error", async () => {
    const client = fakeClient(() => ({ data: { info: {}, parts: [] } }));
    const r = await runCustomPrompt(client, cfg, { prompt: "x", outputMode: "structured" });
    expect(r.error).toMatch(/requires outputSchema/);
  });

  it("text mode concatenates text parts", async () => {
    const client = fakeClient(() => ({ data: { info: {}, parts: [
      { type: "text", text: "hello " }, { type: "text", text: "world" }, { type: "tool", tool: "bash" },
    ] } }));
    const r = await runCustomPrompt(client, cfg, { prompt: "x", outputMode: "text" });
    expect(r.result).toBe("hello world");
  });

  it("none mode returns just the sessionId", async () => {
    const client = fakeClient(() => ({ data: { info: {}, parts: [] } }));
    const r = await runCustomPrompt(client, cfg, { prompt: "x", outputMode: "none", sessionId: "abc" });
    expect(r).toEqual({ sessionId: "abc" });
  });

  it("surfaces info.error", async () => {
    const client = fakeClient(() => ({ data: { info: { error: "boom" }, parts: [] } }));
    const r = await runCustomPrompt(client, cfg, { prompt: "x", outputMode: "text" });
    expect(r.error).toBe("boom");
  });

  it("errors when no model is resolvable", async () => {
    const client = fakeClient(() => ({ data: { info: {}, parts: [] } }));
    const r = await runCustomPrompt(client, { mode: "managed" } as OpenCodeProviderConfig, { prompt: "x", outputMode: "text" });
    expect(r.error).toMatch(/no model/i);
  });
});

// Fake client whose session.prompt resolves to `promptResult`.
function streamingClient(promptResult: unknown): OpenCodeClient {
  return {
    session: {
      create: vi.fn().mockResolvedValue({ data: { id: "sess-1" } }),
      prompt: vi.fn().mockResolvedValue(promptResult),
    },
  } as unknown as OpenCodeClient;
}

const structuredOpts = {
  prompt: "is it open?",
  outputMode: "structured" as const,
  outputSchema: { type: "object", properties: { success: { type: "boolean" } }, required: ["success"] },
  model: "qwen/q3",
};

describe("runCustomPrompt structured reliability", () => {
  it("passes through a valid structured result", async () => {
    const client = streamingClient({ data: { info: { structured: { success: true } }, parts: [] } });
    const r = await runCustomPrompt(client, cfg, structuredOpts);
    expect(r.structured).toEqual({ success: true });
    expect(r.error).toBeUndefined();
  });

  it("salvages a boolean from text when structured is absent", async () => {
    const client = streamingClient({ data: { info: {}, parts: [{ type: "text", text: "Yes, the answer is true." }] } });
    const r = await runCustomPrompt(client, cfg, structuredOpts);
    expect(r.structured).toEqual({ success: true });
  });

  it("fails clearly with the model reply when unsalvageable", async () => {
    const client = streamingClient({ data: { info: {}, parts: [{ type: "text", text: "I cannot determine that." }] } });
    const r = await runCustomPrompt(client, cfg, structuredOpts);
    expect(r.structured).toBeUndefined();
    expect(r.error).toContain("cannot determine");
  });

  it("sends an explicit tools map (all builtins false for a tool-less step)", async () => {
    let captured: any;
    const client = streamingClient({ data: { info: { structured: { success: true } }, parts: [] } });
    (client.session.prompt as any).mockImplementation(async (p: any) => { captured = p; return { data: { info: { structured: { success: true } }, parts: [] } }; });
    await runCustomPrompt(client, cfg, structuredOpts);
    expect(captured.tools.bash).toBe(false);
    expect(captured.tools.read).toBe(false);
  });

  it("sets retryCount on the json_schema format", async () => {
    let captured: any;
    const client = streamingClient({ data: { info: { structured: { success: true } }, parts: [] } });
    (client.session.prompt as any).mockImplementation(async (p: any) => { captured = p; return { data: { info: { structured: { success: true } }, parts: [] } }; });
    await runCustomPrompt(client, cfg, structuredOpts);
    expect(captured.format.type).toBe("json_schema");
    expect(typeof captured.format.retryCount).toBe("number");
  });

  it("dumps the transcript (text parts) to onLog at level all", async () => {
    const client = streamingClient({
      data: { info: { structured: { success: true } }, parts: [{ type: "text", text: "hi there" }] },
    });
    const onLog = vi.fn();
    await runCustomPrompt(client, cfg, { ...structuredOpts, onLog, agentLogLevel: "all" });
    expect(onLog.mock.calls.some((c: any[]) => String(c[0]).includes("hi there"))).toBe(true);
  });

  it("does not dump the transcript at level none", async () => {
    const client = streamingClient({
      data: { info: { structured: { success: true } }, parts: [{ type: "text", text: "secret" }] },
    });
    const onLog = vi.fn();
    await runCustomPrompt(client, cfg, { ...structuredOpts, onLog, agentLogLevel: "none" });
    expect(onLog.mock.calls.some((c: any[]) => String(c[0]).includes("secret"))).toBe(false);
  });
});

describe("opencode runCustomPrompt abort", () => {
  it("throws before creating a session when the signal is already aborted", async () => {
    const ac = new AbortController();
    ac.abort();
    const create = vi.fn();
    const client = { session: { create, prompt: vi.fn(), abort: vi.fn() } } as unknown as OpenCodeClient;
    await expect(
      runCustomPrompt(client, cfg, { prompt: "x", outputMode: "text", model: "openai/gpt-4o", signal: ac.signal }),
    ).rejects.toThrow();
    expect(create).not.toHaveBeenCalled();
  });

  it("aborts the session and throws when the signal fires mid-run", async () => {
    const ac = new AbortController();
    const abort = vi.fn().mockResolvedValue({ data: true });
    const client = fakeClientWithAbort(() => {
      ac.abort();
      return { data: { info: { error: { name: "MessageAbortedError" } }, parts: [] } };
    }, abort);
    await expect(
      runCustomPrompt(client, cfg, { prompt: "x", outputMode: "text", model: "openai/gpt-4o", signal: ac.signal }),
    ).rejects.toThrow();
    expect(abort).toHaveBeenCalledWith({ sessionID: "sess-1" });
  });
});
