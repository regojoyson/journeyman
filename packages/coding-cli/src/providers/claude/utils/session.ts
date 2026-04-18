import { randomUUID } from "node:crypto";

/**
 * Resolves an optional caller-supplied sessionId into the concrete id plus
 * the option fragment to merge into the Claude Agent SDK `query()` options.
 *
 * - Caller provided a non-empty id → `{ resume: id }` — the SDK continues
 *   that session (warm prompt cache, same conversation history).
 * - Caller omitted the id (or passed an empty string) → we generate a UUID
 *   and pass `{ sessionId }` — the SDK assigns that id to a fresh session.
 *
 * An empty string is treated as absent so callers don't accidentally resume
 * with an invalid id when a payload field is unset.
 *
 * The returned `sessionId` is always populated and is what callers should
 * echo back in their own result payload, even on error paths.
 */
export function resolveSession(input?: string): {
  sessionId: string;
  queryOption: { resume: string } | { sessionId: string };
} {
  if (input) {
    return { sessionId: input, queryOption: { resume: input } };
  }
  const sessionId = randomUUID();
  return { sessionId, queryOption: { sessionId } };
}
