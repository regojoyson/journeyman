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
      list: false, patch: false, todowrite: false, task: false, question: false,
    });
    expect(captured.directory).toBe("/workspace");
    expect(captured.agent).toBe("build"); // matches the agent we set maxSteps on
    expect(captured.format.type).toBe("json_schema");
    expect(captured.format.schema).toEqual({ type: "object" });
    expect(typeof captured.format.retryCount).toBe("number");
    expect(r.structured).toEqual({ ok: true });
    expect(r.error).toBeUndefined();
  });

  it("lists cloned repo dirs in the system prompt to point the agent at them", async () => {
    const { mkdtempSync, mkdirSync } = await import("node:fs");
    const { tmpdir } = await import("node:os");
    const { join } = await import("node:path");
    const root = mkdtempSync(join(tmpdir(), "jm-ws-"));
    mkdirSync(join(root, "HireIQ"));
    mkdirSync(join(root, ".cache")); // hidden — excluded from the listing
    let captured: any;
    const client = fakeClient((p) => { captured = p; return { data: { info: {}, parts: [] } }; });
    await runCustomPrompt(client, cfg, { prompt: "x", outputMode: "text", cwd: root });
    expect(captured.system).toContain(join(root, "HireIQ"));
    expect(captured.system).not.toContain(".cache");
  });

  it("recovers structured output via a forced JSON-only turn when the agent ends in prose", async () => {
    const calls: any[] = [];
    const client = fakeClient((p) => {
      calls.push(p);
      if (calls.length === 1) {
        // agent run ended chatty → OpenCode StructuredOutputError + prose parts
        return { data: { info: { error: { name: "StructuredOutputError", data: { retries: 2 } } },
          parts: [{ type: "text", text: "Done. Here's the summary:\n| Step | Result |" }] } };
      }
      // forced tool-free turn → clean structured output
      return { data: { info: { structured: { "spec-path": "docs/spec/x.md" } }, parts: [] } };
    });
    const r = await runCustomPrompt(client, cfg, {
      prompt: "do it", outputMode: "structured",
      outputSchema: { type: "object", properties: { "spec-path": { type: "string" } }, required: ["spec-path"] },
      model: "openai/gpt-4o", tools: ["bash", "search"], cwd: "/workspace",
    });
    expect(r.structured).toEqual({ "spec-path": "docs/spec/x.md" });
    expect(r.error).toBeUndefined();
    expect(calls.length).toBe(2); // agent run + forced turn
    const forced = calls[1];
    expect(forced.agent).toBeUndefined(); // plain completion, not the build agent
    expect(Object.values(forced.tools).every((v) => v === false)).toBe(true); // tools disabled
    expect(forced.format.type).toBe("json_schema");
  });

  it("fails clearly (no prose dump) when even the forced turn can't produce JSON", async () => {
    const client = fakeClient(() => ({
      data: { info: { error: { name: "StructuredOutputError", data: { retries: 2 } } },
        parts: [{ type: "text", text: "Done. Here's the summary:\n| Step | Result |\nSpec at docs/spec/x.md" }] },
    }));
    const r = await runCustomPrompt(client, cfg, {
      prompt: "do it", outputMode: "structured",
      outputSchema: { type: "object", properties: { "spec-path": { type: "string" } }, required: ["spec-path"] },
      model: "openai/gpt-4o", tools: ["bash"], cwd: "/workspace",
    });
    expect(r.structured).toBeUndefined();
    expect(r.error).toBeTruthy(); // clear failure, not a prose blob in spec-path
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

  it("none mode returns the sessionId and usage", async () => {
    const client = fakeClient(() => ({ data: { info: {}, parts: [] } }));
    const r = await runCustomPrompt(client, cfg, { prompt: "x", outputMode: "none", sessionId: "abc" });
    expect(r).toEqual({ sessionId: "abc", usage: [] });
  });

  it("surfaces info.error", async () => {
    const client = fakeClient(() => ({ data: { info: { error: "boom" }, parts: [] } }));
    const r = await runCustomPrompt(client, cfg, { prompt: "x", outputMode: "text" });
    expect(r.error).toBe("boom");
  });

  it("surfaces the HTTP status when session.prompt returns an empty error body", async () => {
    // The opencode SDK collapses a non-2xx response with an empty body to `error: {}`
    // (see @opencode-ai/sdk client.gen.js). The diagnosable detail lives on `response`.
    const client = fakeClient(() => ({
      data: undefined,
      error: {},
      response: { status: 500, statusText: "Internal Server Error" },
    }));
    const r = await runCustomPrompt(client, cfg, { prompt: "x", outputMode: "text", model: "openai/gpt-4o" });
    expect(r.error).toContain("500");
    expect(r.error).toContain("Internal Server Error");
  });

  it("puts confinement in `system` and only the task in `parts` (caching prefix)", async () => {
    let captured: any;
    const client = fakeClient((p) => { captured = p; return { data: { info: {}, parts: [] } }; });
    await runCustomPrompt(client, cfg, { prompt: "the task", outputMode: "text", model: "openai/gpt-4o", cwd: "/workspace" });
    expect(captured.system).toContain("WORKSPACE BOUNDARY");
    expect(captured.parts).toEqual([{ type: "text", text: "the task" }]); // confinement is not inlined into the user part
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

  it("reads the structured result from the `structured_output` key too (version-resilience)", async () => {
    // SDK docs / v1 surface name the field `structured_output`; v2 uses `structured`.
    const client = streamingClient({ data: { info: { structured_output: { success: true } }, parts: [] } });
    const r = await runCustomPrompt(client, cfg, structuredOpts);
    expect(r.structured).toEqual({ success: true });
    expect(r.error).toBeUndefined();
  });

  it("surfaces a StructuredOutputError with its message and retry count (per docs)", async () => {
    const client = streamingClient({
      data: { info: { error: { name: "StructuredOutputError", data: { message: "Model did not produce structured output", retries: 2 } } }, parts: [] },
    });
    const r = await runCustomPrompt(client, cfg, structuredOpts);
    expect(r.error).toBe("StructuredOutputError: Model did not produce structured output (after 2 retries)");
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

  it("salvages from a ```json text block even when opencode reports StructuredOutputError", async () => {
    // Real LM Studio case: opencode's coercion gives up (StructuredOutputError,
    // retries: 0) but the model emitted the JSON as a fenced text block. We must
    // recover it instead of failing the step.
    const schema = { type: "object", properties: { data: { type: "string" }, valid: { type: "boolean" }, count: { type: "number" } }, required: ["data", "valid", "count"] };
    const client = streamingClient({
      data: {
        info: { error: { name: "StructuredOutputError", data: { message: "Model did not produce structured output", retries: 0 } } },
        parts: [{ type: "text", text: 'Input: `hello-sam`\n\n```json\n{\n  "data": "masolleh",\n  "valid": true,\n  "count": 9\n}\n```' }],
      },
    });
    const r = await runCustomPrompt(client, cfg, { prompt: "x", outputMode: "structured", outputSchema: schema, model: "qwen/q3" });
    expect(r.structured).toEqual({ data: "masolleh", valid: true, count: 9 });
    expect(r.error).toBeUndefined();
  });

  it("salvages JSON from the reasoning channel when the content channel is empty", async () => {
    // qwen via LM Studio: with response_format json_schema the answer comes back in
    // `reasoning_content` (a `reasoning` part) and `content` is empty. opencode then
    // reports StructuredOutputError. We must recover from the reasoning channel.
    const schema = { type: "object", properties: { title: { type: "string" }, is_bug: { type: "boolean" } }, required: ["title", "is_bug"] };
    const client = streamingClient({
      data: {
        info: { error: { name: "StructuredOutputError", data: { message: "Model did not produce structured output", retries: 0 } } },
        parts: [
          { type: "text", text: "" },
          { type: "reasoning", text: '{\n  "title": "Login button does nothing on mobile Safari",\n  "is_bug": true\n}' },
        ],
      },
    });
    const r = await runCustomPrompt(client, cfg, { prompt: "x", outputMode: "structured", outputSchema: schema, model: "qwen/q3" });
    expect(r.structured).toEqual({ title: "Login button does nothing on mobile Safari", is_bug: true });
    expect(r.error).toBeUndefined();
  });

  it("still surfaces a session error when there is no salvageable JSON", async () => {
    const schema = { type: "object", properties: { data: { type: "string" }, valid: { type: "boolean" }, count: { type: "number" } }, required: ["data", "valid", "count"] };
    const client = streamingClient({
      data: {
        info: { error: { name: "StructuredOutputError", data: { message: "Model did not produce structured output", retries: 0 } } },
        parts: [{ type: "text", text: "data : mas-olleh valid : true count : 9" }],
      },
    });
    const r = await runCustomPrompt(client, cfg, { prompt: "x", outputMode: "structured", outputSchema: schema, model: "qwen/q3" });
    expect(r.structured).toBeUndefined();
    expect(r.error).toContain("StructuredOutputError");
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

// Helper: a client with a scripted event stream + prompt + messages.
function fakeStreamingClient(opts: {
  events: unknown[];
  promptResult: any;
  messages?: any[];
  subscribeRejects?: boolean;
}): OpenCodeClient {
  async function* gen() { for (const e of opts.events) yield e; }
  return {
    session: {
      create: vi.fn().mockResolvedValue({ data: { id: "sess-1" } }),
      prompt: vi.fn().mockResolvedValue(opts.promptResult),
      messages: vi.fn().mockResolvedValue({ data: opts.messages ?? [] }),
      abort: vi.fn(),
    },
    event: {
      subscribe: opts.subscribeRejects
        ? vi.fn().mockRejectedValue(new Error("no sse"))
        : vi.fn().mockResolvedValue({ stream: gen() }),
    },
  } as unknown as OpenCodeClient;
}

const pu = (part: Record<string, unknown>) => ({
  type: "message.part.updated", properties: { sessionID: "sess-1", part, time: 0 },
});

describe("opencode runCustomPrompt — live logging", () => {
  it("streams tool calls live and does NOT re-dump from session.messages", async () => {
    const onLog = vi.fn();
    const client = fakeStreamingClient({
      events: [
        pu({ id: "p1", type: "tool", tool: "bash", state: { status: "running", input: { command: "git clone" } } }),
        pu({ id: "p1", type: "tool", tool: "bash", state: { status: "completed", input: { command: "git clone" } } }),
        pu({ id: "t1", type: "text", text: "Done." }),
        { type: "session.idle", properties: { sessionID: "sess-1" } },
      ],
      promptResult: { data: { info: {}, parts: [{ type: "text", text: "Done." }] } },
    });
    const r = await runCustomPrompt(client, cfg, { prompt: "go", outputMode: "text", onLog, agentLogLevel: "all" });

    const lines = onLog.mock.calls.map((c: any[]) => String(c[0]));
    expect(lines.some((l) => l.includes("🔧 tool: bash"))).toBe(true);
    expect(lines.some((l) => l.includes("bash: ok"))).toBe(true);
    expect((client.session as any).messages).not.toHaveBeenCalled();
    expect(r.result).toBe("Done.");
  });

  it("falls back to session.messages full dump when the stream yields nothing", async () => {
    const onLog = vi.fn();
    const client = fakeStreamingClient({
      events: [],
      subscribeRejects: true,
      promptResult: { data: { info: {}, parts: [{ type: "text", text: "final" }] } },
      messages: [{ info: {}, parts: [
        { type: "tool", tool: "write", state: { status: "completed", input: { path: "/spec.md" } } },
        { type: "text", text: "final" },
      ] }],
    });
    await runCustomPrompt(client, cfg, { prompt: "go", outputMode: "text", onLog, agentLogLevel: "all" });

    expect((client.session as any).messages).toHaveBeenCalledWith({ sessionID: "sess-1" });
    const lines = onLog.mock.calls.map((c: any[]) => String(c[0]));
    expect(lines.some((l) => l.includes("🔧 tool: write"))).toBe(true);
  });

  it("does not stream or fall back when onLog is absent", async () => {
    const client = fakeStreamingClient({
      events: [pu({ id: "p1", type: "tool", tool: "bash", state: { status: "completed" } })],
      promptResult: { data: { info: {}, parts: [] } },
    });
    const r = await runCustomPrompt(client, cfg, { prompt: "go", outputMode: "text" });
    expect((client as any).event.subscribe).not.toHaveBeenCalled();
    expect(r.error).toBeUndefined();
  });
});
