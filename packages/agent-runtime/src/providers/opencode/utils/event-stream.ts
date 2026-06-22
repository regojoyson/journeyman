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
        const e = ev as { type?: string; properties?: { sessionID?: string; part?: OpenCodePart } };
        // The agent loop finished (or errored) for our session — stop consuming.
        // The global event stream stays open for other sessions, so we must break
        // explicitly rather than wait for it to end. stop() (abort) covers the
        // user-cancellation path via the signal handed to event.subscribe.
        if ((e.type === "session.idle" || e.type === "session.error") && e.properties?.sessionID === sessionID) break;
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
