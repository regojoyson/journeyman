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

describe("opencode runCustomPrompt", () => {
  it("structured mode passes the schema and returns info.structured", async () => {
    let captured: any;
    const client = fakeClient((p) => { captured = p; return { data: { info: { structured: { ok: true } }, parts: [] } }; });
    const r = await runCustomPrompt(client, cfg, {
      prompt: "do it", outputMode: "structured", outputSchema: { type: "object" },
      model: "openai/gpt-4o", tools: ["bash", "search"], cwd: "/workspace",
    });
    expect(captured.model).toEqual({ providerID: "openai", modelID: "gpt-4o" });
    expect(captured.tools).toEqual({ bash: true, grep: true, glob: true });
    expect(captured.directory).toBe("/workspace");
    expect(captured.format).toEqual({ type: "json_schema", schema: { type: "object" } });
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
