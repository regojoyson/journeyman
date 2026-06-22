import { createLogger } from "@journeyman/core";
import type { OpenCodeClient } from "../client.ts";
import type { OpenCodePart } from "./sdk-logger.ts";

const log = createLogger("opencode:event-stream");

/** A loggable event derived from the SSE stream, ready for the sdk-logger renderers. */
export type LogEvent =
  | { kind: "tool-invoke"; part: OpenCodePart }
  | { kind: "tool-result"; part: OpenCodePart }
  | { kind: "text"; part: OpenCodePart }
  | { kind: "reasoning"; part: OpenCodePart };

/**
 * Minimum gap between live reasoning emits for a single thought. A reasoning model
 * can stream one block for minutes before it settles; emitting on `time.end` only
 * would show nothing during that whole window (looks stuck). We emit on first sight,
 * then at most once per this interval as the text grows, then once on settle.
 */
const REASONING_THROTTLE_MS = 5000;

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
  const emittedText = new Set<string>();
  // Per-thought throttle state: when we last emitted, how much text we had emitted,
  // and the latest part (for an end-of-stream flush of a never-settled thought).
  const reasoning = new Map<string, { lastEmit: number; emittedLen: number; part: OpenCodePart }>();
  let emitted = 0;
  let degraded = false;

  const out = (e: LogEvent) => { emitted++; emit(e); };

  // How the consume loop terminated — surfaced in the teardown log so a future
  // hang/regression shows whether the stream settled (idle), errored, ended on its
  // own, or was aborted, rather than leaving us guessing.
  let endReason: "session.idle" | "session.error" | "stream-end" | "aborted" | "error" = "stream-end";

  const run = async (): Promise<{ emitted: number; degraded: boolean }> => {
    try {
      // `signal` is a typed field on the SDK's request Options (Config extends
      // RequestInit), so no cast is needed — abort() tears the SSE fetch down.
      const sub = await client.event.subscribe(undefined, { signal: controller.signal });

      for await (const ev of sub.stream) {
        const e = ev as { type?: string; properties?: { sessionID?: string; part?: OpenCodePart } };
        // The agent loop finished (or errored) for our session — stop consuming.
        // The global event stream stays open for other sessions, so we must break
        // explicitly rather than wait for it to end. stop() (abort) covers the
        // user-cancellation path via the signal handed to event.subscribe.
        if ((e.type === "session.idle" || e.type === "session.error") && e.properties?.sessionID === sessionID) {
          endReason = e.type as "session.idle" | "session.error";
          break;
        }
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
          const id = part.id ?? `text:${texts.size}`;
          texts.set(id, part);
          // Emit each text segment the moment it settles (time.end present),
          // deduped by id — the text analogue of a tool's "completed" transition.
          // Streaming deltas (no end yet) are skipped so we don't spam partials.
          if (!emittedText.has(id) && part.text?.trim() && part.time?.end != null) {
            out({ kind: "text", part });
            emittedText.add(id);
          }
        } else if (part.type === "reasoning" && typeof part.text === "string") {
          // Reasoning streams like text (same id, growing text, time.end on settle)
          // but can run long before settling — so we emit live on a throttle rather
          // than only at the end. Emit when the text has grown beyond what we last
          // emitted AND (first sight | settled | throttle window elapsed). The
          // grew-since-emit guard also dedupes the settle emit against the last
          // throttled one.
          const id = part.id ?? `reasoning:${reasoning.size}`;
          const prev = reasoning.get(id);
          const len = part.text.length;
          const now = Date.now();
          const grewSinceEmit = len > (prev?.emittedLen ?? 0);
          const settled = part.time?.end != null;
          const due = now - (prev?.lastEmit ?? 0) >= REASONING_THROTTLE_MS;
          if (part.text.trim() && grewSinceEmit && (prev === undefined || settled || due)) {
            out({ kind: "reasoning", part });
            reasoning.set(id, { lastEmit: now, emittedLen: len, part });
          } else {
            reasoning.set(id, { lastEmit: prev?.lastEmit ?? 0, emittedLen: prev?.emittedLen ?? 0, part });
          }
        }
      }
    } catch (err) {
      // An intentional stop() aborts the fetch; that is not degradation.
      if (!controller.signal.aborted) {
        degraded = true;
        endReason = "error";
        log.warn({ err: String((err as Error)?.message ?? err) }, "event stream errored");
      } else {
        endReason = "aborted";
      }
    } finally {
      // Always tear down the SSE connection when the loop ends — including the
      // happy path, which `break`s on session.idle without ever calling stop().
      // event.subscribe opens a long-lived streaming fetch that never times out;
      // leaving it open keeps a handle on the runner's event loop, so the one-shot
      // runner process would not exit and the run would hang after the result.
      // abort() is idempotent, so the stop()/abort paths are unaffected.
      controller.abort();
    }
    // Fallback: emit any text segment that never received an end marker
    // (or arrived after we stopped), once, in arrival order.
    for (const [id, part] of texts) {
      if (!emittedText.has(id) && part.text?.trim()) { out({ kind: "text", part }); emittedText.add(id); }
    }
    // Same for a reasoning block that ended (stream stopped/aborted mid-think) with
    // unemitted tail: flush the latest text once so nothing is silently dropped.
    for (const [, st] of reasoning) {
      if (st.part.text?.trim() && st.part.text.length > st.emittedLen) {
        out({ kind: "reasoning", part: st.part });
        st.emittedLen = st.part.text.length;
      }
    }
    log.info({ sessionID, endReason, emitted, degraded }, "session log stream torn down");
    return { emitted, degraded };
  };

  const done = run();
  return { done, stop: () => controller.abort() };
}
