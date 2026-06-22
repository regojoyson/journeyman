# OpenCode Live Logging Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stream opencode runs to the log live (tool calls as they happen + the final assistant text), with a full-transcript fallback when the live feed produces nothing.

**Architecture:** Subscribe to opencode's SSE event stream (`client.event.subscribe()`) concurrently with the blocking `session.prompt()` call, forwarding `message.part.updated` events through the existing `onLog` channel. A shared part-renderer is reused by both the live path and a `session.messages()` fallback dump. All changes confined to the opencode provider.

**Tech Stack:** TypeScript, `@opencode-ai/sdk/v2`, vitest.

**Execution constraints (per request):**
- **Branch:** work directly on `master`. Do **not** create a feature branch or worktree.
- **No commits.** Skip all `git commit` steps. Leave changes in the working tree.
- **Typecheck once, at the very end** (Task 4) — not per task. Run vitest per task as written.

---

## Background: exact SDK shapes (verified)

```ts
// client.event.subscribe() resolves to { stream }, an async generator of Event:
const sub = await client.event.subscribe();
for await (const ev of sub.stream) { /* ev is a discriminated union */ }

// The event we care about:
//   ev.type === "message.part.updated"
//   ev.properties.sessionID: string
//   ev.properties.part: Part   // { id, type: "text"|"tool"|..., text?, tool?, state? }

// Fallback full history:
const msgs = await client.session.messages({ sessionID: sid });
// msgs.data: Array<{ info, parts: Part[] }>

// subscribe accepts a RequestInit-style options arg, so we can pass { signal }
//   to abort the underlying fetch on stop().
```

`Part` matches the existing `OpenCodePart` interface in `utils/sdk-logger.ts`
(`{ type, text?, tool?, state?: { status?, input?, error? } }`) — we add an optional `id`.

## File structure

| File | Responsibility | Change |
|---|---|---|
| `packages/agent-runtime/src/providers/opencode/utils/sdk-logger.ts` | Render a single part into log line(s); gate by `agentLogLevel`. | Modify — split rendering into `renderToolInvocation` / `renderToolResult` / `renderText` / `renderPart`; keep `logOpenCodeTranscript` behavior identical. |
| `packages/agent-runtime/src/providers/opencode/utils/sdk-logger.test.ts` | Tests for the renderers. | Modify — existing tests must still pass; add direct renderer tests. |
| `packages/agent-runtime/src/providers/opencode/utils/event-stream.ts` | Own the SSE lifecycle: subscribe, filter to our session, dedup, buffer+flush text, emit `LogEvent`s, report `{ emitted, degraded }`, `stop()`. | **Create.** |
| `packages/agent-runtime/src/providers/opencode/utils/event-stream.test.ts` | Tests for the subscriber with a fake event feed. | **Create.** |
| `packages/agent-runtime/src/providers/opencode/operations/run-custom-prompt.ts` | Orchestrate: start subscriber → prompt → stop → fallback dump if nothing streamed. | Modify — replace the unconditional `logOpenCodeTranscript(res.data.parts)` dump. |
| `packages/agent-runtime/src/providers/opencode/operations/run-custom-prompt.test.ts` | Run tests. | Modify — add live/fallback/abort cases; existing result tests unchanged. |

---

## Task 1: Split the part renderer in `sdk-logger.ts`

**Files:**
- Modify: `packages/agent-runtime/src/providers/opencode/utils/sdk-logger.ts`
- Test: `packages/agent-runtime/src/providers/opencode/utils/sdk-logger.test.ts`

- [ ] **Step 1: Add failing tests for the new renderers**

Append to `sdk-logger.test.ts`:

```ts
import {
  renderToolInvocation, renderToolResult, renderText, renderPart,
} from "./sdk-logger.ts";

describe("split renderers", () => {
  it("renderToolInvocation emits the 🔧 line at medium/all, nothing at none", () => {
    const all = vi.fn();
    renderToolInvocation(toolOk, all, "all");
    expect(all.mock.calls[0][0]).toContain("🔧 tool: read");
    expect(all.mock.calls[0][0]).toContain("/x");

    const none = vi.fn();
    renderToolInvocation(toolOk, none, "none");
    expect(none).not.toHaveBeenCalled();
  });

  it("renderToolResult emits 📥 ok/error only at all", () => {
    const all = vi.fn();
    renderToolResult(toolOk, all, "all");
    expect(all.mock.calls.some((c: any[]) => String(c[0]).includes("read: ok"))).toBe(true);

    const medium = vi.fn();
    renderToolResult(toolErr, medium, "medium");
    expect(medium).not.toHaveBeenCalled();
  });

  it("renderText emits 🤖 line only at all", () => {
    const all = vi.fn();
    renderText(textPart, all, "all");
    expect(all.mock.calls[0][0]).toContain("hello");

    const medium = vi.fn();
    renderText(textPart, medium, "medium");
    expect(medium).not.toHaveBeenCalled();
  });

  it("renderPart on a completed tool emits both invocation and result at all", () => {
    const all = vi.fn();
    renderPart(toolOk, all, "all");
    const lines = all.mock.calls.map((c: any[]) => String(c[0]));
    expect(lines.some((l) => l.includes("🔧 tool: read"))).toBe(true);
    expect(lines.some((l) => l.includes("read: ok"))).toBe(true);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd packages/agent-runtime && npx vitest run src/providers/opencode/utils/sdk-logger.test.ts`
Expected: FAIL — `renderToolInvocation`/`renderToolResult`/`renderText`/`renderPart` are not exported.

- [ ] **Step 3: Refactor `sdk-logger.ts` to expose the split renderers**

In `sdk-logger.ts`, add `id?: string` to `OpenCodePart`, then replace the body of `logOpenCodeTranscript` with calls to new exported helpers. Final form of the relevant section:

```ts
export interface OpenCodePart {
  type: string;
  id?: string;
  text?: string;
  tool?: string;
  state?: { status?: string; input?: Record<string, unknown>; error?: string };
  [k: string]: unknown;
}

/** Emit the `🔧 tool: name(args)` invocation line (gated at medium/all). */
export function renderToolInvocation(part: OpenCodePart, onLog?: CodingCliLogFn, level: AgentLogLevel = "all"): void {
  const tool = typeof part.tool === "string" ? part.tool : "tool";
  log.debug({ tool, status: part.state?.status }, "tool part");
  if (!onLog || !allowsToolUse(level)) return;
  const arg = summarizeInput(part.state?.input);
  onLog(singleLine(arg ? `🔧 tool: ${tool}(${arg})` : `🔧 tool: ${tool}`, MAX_LINE_LEN), { part });
}

/** Emit the `📥 name: ok|error` result line (gated at all). */
export function renderToolResult(part: OpenCodePart, onLog?: CodingCliLogFn, level: AgentLogLevel = "all"): void {
  if (!onLog || !allowsToolResult(level)) return;
  const tool = typeof part.tool === "string" ? part.tool : "tool";
  const st = part.state ?? {};
  if (st.status === "error") {
    onLog(singleLine(`📥 ${tool}: error: ${st.error ?? ""}`, MAX_LINE_LEN), { part });
  } else if (st.status === "completed") {
    onLog(`📥 ${tool}: ok`, { part });
  }
}

/** Emit the `🤖 assistant: text` line (gated at all). */
export function renderText(part: OpenCodePart, onLog?: CodingCliLogFn, level: AgentLogLevel = "all"): void {
  if (typeof part.text !== "string" || !part.text) return;
  log.debug({ text: part.text }, "assistant text");
  if (onLog && allowsAssistantText(level)) {
    onLog(singleLine(`🤖 assistant: ${part.text}`, MAX_LINE_LEN), { part });
  }
}

/** Render a single part fully (invocation + result + text) — used by the fallback dump. */
export function renderPart(part: OpenCodePart, onLog?: CodingCliLogFn, level: AgentLogLevel = "all"): void {
  if (part.type === "text") {
    renderText(part, onLog, level);
  } else if (part.type === "tool") {
    renderToolInvocation(part, onLog, level);
    renderToolResult(part, onLog, level);
  }
}

/**
 * Emit the model's transcript (text + tool calls) to the UI log via `onLog`,
 * gated by `level`. Used by the end-of-run fallback dump.
 */
export function logOpenCodeTranscript(
  parts: readonly OpenCodePart[] | undefined,
  onLog?: CodingCliLogFn,
  level: AgentLogLevel = "all",
): void {
  const ui = onLog && level !== "none" ? onLog : undefined;
  for (const part of parts ?? []) renderPart(part, ui, level);
}
```

Keep `singleLine`, `summarizeInput`, `allowsAssistantText`, `allowsToolUse`, `allowsToolResult`, `MAX_LINE_LEN`, `log`, and `logSessionEvent` exactly as they are.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd packages/agent-runtime && npx vitest run src/providers/opencode/utils/sdk-logger.test.ts`
Expected: PASS — both the new renderer tests and the pre-existing `logOpenCodeTranscript` tests.

---

## Task 2: Create the SSE subscriber `event-stream.ts`

**Files:**
- Create: `packages/agent-runtime/src/providers/opencode/utils/event-stream.ts`
- Test: `packages/agent-runtime/src/providers/opencode/utils/event-stream.test.ts`

- [ ] **Step 1: Write the failing test**

Create `event-stream.test.ts`:

```ts
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

  it("buffers text and flushes the latest text once on stream end", async () => {
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
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd packages/agent-runtime && npx vitest run src/providers/opencode/utils/event-stream.test.ts`
Expected: FAIL — `./event-stream.ts` does not exist.

- [ ] **Step 3: Implement `event-stream.ts`**

Create `event-stream.ts`:

```ts
import { createLogger } from "@journeyman/core";
import type { OpenCodeClient } from "../client.ts";
import type { OpenCodePart } from "./sdk-logger.ts";

const log = createLogger("opencode:event-stream");

/** A loggable event derived from the SSE stream, ready for the sdk-logger renderers. */
export type LogEvent =
  | { kind: "tool-invoke"; part: OpenCodePart }
  | { kind: "tool-result"; part: OpenCodePart }
  | { kind: "text"; part: OpenCodePart };

export interface SessionLogStream {
  /** Resolves once the stream is torn down. `emitted` counts LogEvents forwarded;
   *  `degraded` is true if the SSE feed errored (caller should fall back). */
  done: Promise<{ emitted: number; degraded: boolean }>;
  /** Stop consuming the SSE stream and flush any buffered text parts. */
  stop: () => void;
}

interface ToolState { invoked: boolean; done: boolean; }

/**
 * Subscribe to opencode's SSE event stream and forward `message.part.updated`
 * events for `sessionID` as {@link LogEvent}s, live. Tool parts emit an invocation
 * on first sight and a result once completed/errored (deduped by part id). Text
 * parts are buffered and the latest text flushed once when the stream ends — we
 * stream tool activity live but settle assistant text rather than spamming deltas.
 */
export function streamSessionLog(
  client: OpenCodeClient,
  sessionID: string,
  emit: (e: LogEvent) => void,
): SessionLogStream {
  const controller = new AbortController();
  const tools = new Map<string, ToolState>();
  const texts = new Map<string, OpenCodePart>();
  let emitted = 0;
  let degraded = false;

  const out = (e: LogEvent) => { emitted++; emit(e); };

  const run = async (): Promise<{ emitted: number; degraded: boolean }> => {
    try {
      const sub = await (client.event.subscribe as (
        p?: unknown, o?: { signal?: AbortSignal },
      ) => Promise<{ stream: AsyncIterable<unknown> }>)(undefined, { signal: controller.signal });

      for await (const ev of sub.stream) {
        if (controller.signal.aborted) break;
        const e = ev as { type?: string; properties?: { sessionID?: string; part?: OpenCodePart } };
        if (e.type !== "message.part.updated" || e.properties?.sessionID !== sessionID) continue;
        const part = e.properties.part;
        if (!part) continue;

        if (part.type === "tool") {
          const id = part.id ?? `${part.tool ?? "tool"}:${tools.size}`;
          const st = tools.get(id) ?? { invoked: false, done: false };
          if (!st.invoked) { out({ kind: "tool-invoke", part }); st.invoked = true; }
          const status = part.state?.status;
          if (!st.done && (status === "completed" || status === "error")) {
            out({ kind: "tool-result", part }); st.done = true;
          }
          tools.set(id, st);
        } else if (part.type === "text" && typeof part.text === "string") {
          texts.set(part.id ?? `text:${texts.size}`, part);
        }
      }
    } catch (err) {
      // An intentional stop() aborts the fetch; that is not degradation.
      if (!controller.signal.aborted) {
        degraded = true;
        log.warn({ err: String((err as Error)?.message ?? err) }, "event stream errored");
      }
    }
    // Flush settled text once, in arrival order.
    for (const part of texts.values()) if (part.text) out({ kind: "text", part });
    return { emitted, degraded };
  };

  const done = run();
  return { done, stop: () => controller.abort() };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd packages/agent-runtime && npx vitest run src/providers/opencode/utils/event-stream.test.ts`
Expected: PASS — all four cases.

---

## Task 3: Wire the subscriber into `run-custom-prompt.ts`

**Files:**
- Modify: `packages/agent-runtime/src/providers/opencode/operations/run-custom-prompt.ts`
- Test: `packages/agent-runtime/src/providers/opencode/operations/run-custom-prompt.test.ts`

- [ ] **Step 1: Write failing tests for live streaming, fallback, and no-double-dump**

Append to `run-custom-prompt.test.ts`:

```ts
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
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd packages/agent-runtime && npx vitest run src/providers/opencode/operations/run-custom-prompt.test.ts`
Expected: FAIL — `event.subscribe` is never called / `messages` not called / lines missing, because the current code only dumps `res.data.parts`.

- [ ] **Step 3: Wire `streamSessionLog` and the fallback into `run-custom-prompt.ts`**

In `run-custom-prompt.ts`:

1. Update the import on line 3 from:

```ts
import { logOpenCodeTranscript, logSessionEvent } from "../utils/sdk-logger.ts";
```

to:

```ts
import {
  logOpenCodeTranscript, logSessionEvent,
  renderToolInvocation, renderToolResult, renderText,
} from "../utils/sdk-logger.ts";
import { streamSessionLog } from "../utils/event-stream.ts";
```

2. Immediately after `const sid = session.data.id;` (currently line 101), start the subscriber:

```ts
  // Live log streaming: forward opencode's SSE part events through onLog as they
  // happen. Only when a UI log sink is present.
  const level = opts.agentLogLevel ?? "all";
  const logStream = opts.onLog
    ? streamSessionLog(client, sid, (e) => {
        if (e.kind === "tool-invoke") renderToolInvocation(e.part, opts.onLog, level);
        else if (e.kind === "tool-result") renderToolResult(e.part, opts.onLog, level);
        else renderText(e.part, opts.onLog, level);
      })
    : undefined;
```

3. In the `finally` block of the prompt call (currently lines 124-126), stop the stream:

```ts
  } finally {
    opts.signal?.removeEventListener("abort", onAbort);
    logStream?.stop();
  }

  const streamInfo = logStream ? await logStream.done : { emitted: 0, degraded: false };
```

4. Replace the unconditional dump (currently line 137-138):

```ts
  // Dump the model transcript (text + tool calls) to the UI log, gated by level.
  logOpenCodeTranscript((res.data as { parts?: unknown }).parts as never, opts.onLog, opts.agentLogLevel ?? "all");
```

with the fallback-only dump:

```ts
  // If the live feed produced nothing (SSE failed/empty), dump the full transcript
  // from the stable messages endpoint so we never regress to a single final line.
  if (opts.onLog && streamInfo.emitted === 0) {
    try {
      const msgs = await client.session.messages({ sessionID: sid });
      const parts = ((msgs.data ?? []) as Array<{ parts?: unknown[] }>).flatMap((m) => m.parts ?? []);
      logOpenCodeTranscript(parts as never, opts.onLog, level);
    } catch {
      logOpenCodeTranscript((res.data as { parts?: unknown }).parts as never, opts.onLog, level);
    }
  }
```

Leave everything else (`logSessionEvent`, `openCodeInfoToTokenUsage`, result/structured extraction) unchanged.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd packages/agent-runtime && npx vitest run src/providers/opencode/operations/run-custom-prompt.test.ts`
Expected: PASS — new live/fallback/no-onLog cases plus all pre-existing structured/text/abort cases.

---

## Task 4: Full opencode suite + typecheck (final gate)

**Files:** none (verification only).

- [ ] **Step 1: Run the full opencode provider test suite**

Run: `cd packages/agent-runtime && npx vitest run src/providers/opencode`
Expected: PASS — all opencode tests green (sdk-logger, event-stream, run-custom-prompt, and the rest).

- [ ] **Step 2: Typecheck the whole workspace**

Run: `cd /Users/admin/data/workspace/claude-skils/journeyman && npm run typecheck`
Expected: PASS — no type errors. (This is the single typecheck for the whole change, per request.)

- [ ] **Step 3: Leave changes uncommitted**

Do **not** commit. Report the modified/created files and the test + typecheck results to the user for review.

---

## Self-review notes

- **Spec coverage:** live streaming (Task 2 + 3), shared renderer / DRY (Task 1), `session.messages()` fallback on empty feed (Task 3), no double-printing (subscriber dedup + `emitted === 0` gate), clean shutdown (`stop()` aborts the fetch; flush on end), `onLog`-absent no-op (Task 3 test), all-sandbox coverage (transport-agnostic — rides existing `onLog`). Error handling: subscribe rejection → degraded → fallback (Task 2 + 3 tests); `messages` failure → last-ditch `res.data.parts` dump (Task 3 code).
- **Fallback trigger** is `emitted === 0` (not `degraded`) to make double-logging impossible: if the stream emitted anything, we trust the live log and skip the dump; only a fully empty/failed feed triggers the fallback.
- **Out of scope (per design):** assistant text deltas (we flush settled text), other providers, UI/worker changes.
