import { randomUUID } from "node:crypto";

/**
 * Resolves session identifiers for a Claude Agent SDK `query()` call.
 *
 * The caller-supplied `input` is treated as a correlation id (e.g. a pipeline
 * run id) — NOT as a conversation to resume. Every invocation starts a fresh
 * SDK conversation with its own random UUID. Sharing a conversation across
 * steps produces cross-step bash-transcript bloat and breaks when steps
 * use different structured-output schemas or tool sets.
 *
 * Returns:
 * - `sessionId`: the id the caller should echo back in its result payload.
 *   Equal to `input` when provided (so callers preserve correlation), or a
 *   fresh UUID when absent.
 * - `queryOption`: always `{ sessionId: <freshUuid> }` — a new SDK session.
 *
 * An empty string is treated as absent.
 */
export function resolveSession(input?: string): {
  sessionId: string;
  queryOption: { sessionId: string };
} {
  const correlationId = input && input.length > 0 ? input : randomUUID();
  return {
    sessionId: correlationId,
    queryOption: { sessionId: randomUUID() },
  };
}
