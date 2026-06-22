import { describe, it, expect, vi } from "vitest";
import { streamSessionLog } from "./event-stream.ts";
import type { OpenCodeClient } from "../client.ts";

/** A fake client whose event.subscribe yields a scripted list of events, then ends. */
function fakeEventClient(events: unknown[]): OpenCodeClient {
  async function* gen() { for (const e of events) yield e; }
  return {
    event: { subscribe: vi.fn().mockResolvedValue({ stream: gen() }) },
  } as unknown as OpenCodeClient;
}

const partUpdated = (sessionID: string, part: Record<string, unknown>) => ({
  type: "message.part.updated", properties: { sessionID, part, time: 0 },
});

describe("streamSessionLog", () => {
  it("emits tool-invoke once and tool-result once for a tool that completes", async () => {
    const client = fakeEventClient([
      partUpdated("sid", { id: "p1", type: "tool", tool: "bash", state: { status: "running", input: { command: "ls" } } }),
      partUpdated("sid", { id: "p1", type: "tool", tool: "bash", state: { status: "completed", input: { command: "ls" } } }),
    ]);
    const emit = vi.fn();
    const s = streamSessionLog(client, "sid", emit);
    const result = await s.done;

    const kinds = emit.mock.calls.map((c: any[]) => c[0].kind);
    expect(kinds).toEqual(["tool-invoke", "tool-result"]);
    expect(result.degraded).toBe(false);
    expect(result.emitted).toBe(2);
  });

  it("ignores events for other sessions", async () => {
    const client = fakeEventClient([
      partUpdated("other", { id: "p1", type: "tool", tool: "bash", state: { status: "running" } }),
    ]);
    const emit = vi.fn();
    const s = streamSessionLog(client, "sid", emit);
    await s.done;
    expect(emit).not.toHaveBeenCalled();
  });

  it("flushes a never-settled text part (no time.end) once at stream end", async () => {
    const client = fakeEventClient([
      partUpdated("sid", { id: "t1", type: "text", text: "Hel" }),
      partUpdated("sid", { id: "t1", type: "text", text: "Hello done" }),
    ]);
    const emit = vi.fn();
    const s = streamSessionLog(client, "sid", emit);
    await s.done;
    const textCalls = emit.mock.calls.filter((c: any[]) => c[0].kind === "text");
    expect(textCalls.length).toBe(1);
    expect(textCalls[0][0].part.text).toBe("Hello done");
  });

  it("emits each text segment live (interleaved with tools) when it settles via time.end", async () => {
    const client = fakeEventClient([
      // streaming delta first (no end) — must NOT emit yet
      partUpdated("sid", { id: "t1", type: "text", text: "First" }),
      partUpdated("sid", { id: "t1", type: "text", text: "First done", time: { start: 0, end: 1 } }),
      partUpdated("sid", { id: "p1", type: "tool", tool: "bash", state: { status: "running", input: { command: "ls" } } }),
      partUpdated("sid", { id: "p1", type: "tool", tool: "bash", state: { status: "completed", input: { command: "ls" } } }),
      partUpdated("sid", { id: "t2", type: "text", text: "Second done", time: { start: 2, end: 3 } }),
    ]);
    const emit = vi.fn();
    const s = streamSessionLog(client, "sid", emit);
    await s.done;
    const kinds = emit.mock.calls.map((c: any[]) => c[0].kind);
    expect(kinds).toEqual(["text", "tool-invoke", "tool-result", "text"]);
    const texts = emit.mock.calls.filter((c: any[]) => c[0].kind === "text").map((c: any[]) => c[0].part.text);
    expect(texts).toEqual(["First done", "Second done"]);
  });

  it("does not emit whitespace-only text parts (live or at stream end)", async () => {
    const client = fakeEventClient([
      partUpdated("sid", { id: "t1", type: "text", text: "\n\n", time: { start: 0, end: 1 } }),
      partUpdated("sid", { id: "t2", type: "text", text: "   " }),
    ]);
    const emit = vi.fn();
    const s = streamSessionLog(client, "sid", emit);
    await s.done;
    expect(emit.mock.calls.filter((c: any[]) => c[0].kind === "text").length).toBe(0);
  });

  it("does not re-emit at stream end a text part already emitted live", async () => {
    const client = fakeEventClient([
      partUpdated("sid", { id: "t1", type: "text", text: "Hi", time: { start: 0, end: 1 } }),
    ]);
    const emit = vi.fn();
    const s = streamSessionLog(client, "sid", emit);
    await s.done;
    const textCalls = emit.mock.calls.filter((c: any[]) => c[0].kind === "text");
    expect(textCalls.length).toBe(1);
  });

  it("emits reasoning live on first sight, throttles a rapid update, emits on settle", async () => {
    const nowSpy = vi.spyOn(Date, "now");
    nowSpy.mockReturnValueOnce(1000) // first sight -> emit
      .mockReturnValueOnce(1100)     // +100ms, within 5s window -> skip
      .mockReturnValueOnce(1200);    // settled (grew since last emit) -> emit
    const client = fakeEventClient([
      partUpdated("sid", { id: "r1", type: "reasoning", text: "thinking a", time: { start: 0 } }),
      partUpdated("sid", { id: "r1", type: "reasoning", text: "thinking ab", time: { start: 0 } }),
      partUpdated("sid", { id: "r1", type: "reasoning", text: "thinking abc", time: { start: 0, end: 5 } }),
    ]);
    const emit = vi.fn();
    const s = streamSessionLog(client, "sid", emit);
    await s.done;
    const texts = emit.mock.calls.filter((c: any[]) => c[0].kind === "reasoning").map((c: any[]) => c[0].part.text);
    expect(texts).toEqual(["thinking a", "thinking abc"]);
    nowSpy.mockRestore();
  });

  it("emits a reasoning update once the throttle window has elapsed", async () => {
    const nowSpy = vi.spyOn(Date, "now");
    nowSpy.mockReturnValueOnce(1000).mockReturnValueOnce(7000); // 6s later, > 5s window
    const client = fakeEventClient([
      partUpdated("sid", { id: "r1", type: "reasoning", text: "aaaa", time: { start: 0 } }),
      partUpdated("sid", { id: "r1", type: "reasoning", text: "aaaabbbb", time: { start: 0 } }),
    ]);
    const emit = vi.fn();
    const s = streamSessionLog(client, "sid", emit);
    await s.done;
    expect(emit.mock.calls.filter((c: any[]) => c[0].kind === "reasoning").length).toBe(2);
    nowSpy.mockRestore();
  });

  it("aborts the SSE subscription once the stream loop ends (no leaked connection)", async () => {
    // Regression: on the happy path the loop `break`s on session.idle without
    // calling stop(); the subscription must still be torn down or the runner's
    // event loop never drains and the one-shot process hangs after the result.
    let captured: AbortSignal | undefined;
    async function* gen() {
      yield partUpdated("sid", { id: "t1", type: "text", text: "done", time: { start: 0, end: 1 } });
      yield { type: "session.idle", properties: { sessionID: "sid" } };
    }
    const client = {
      event: {
        subscribe: vi.fn((_p: unknown, o?: { signal?: AbortSignal }) => {
          captured = o?.signal;
          return Promise.resolve({ stream: gen() });
        }),
      },
    } as unknown as OpenCodeClient;
    const s = streamSessionLog(client, "sid", vi.fn());
    await s.done;
    expect(captured?.aborted).toBe(true);
  });

  it("marks degraded when subscribe rejects, emitting nothing", async () => {
    const client = { event: { subscribe: vi.fn().mockRejectedValue(new Error("boom")) } } as unknown as OpenCodeClient;
    const emit = vi.fn();
    const s = streamSessionLog(client, "sid", emit);
    const result = await s.done;
    expect(result.degraded).toBe(true);
    expect(result.emitted).toBe(0);
    expect(emit).not.toHaveBeenCalled();
  });
});
