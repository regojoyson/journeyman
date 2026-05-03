/**
 * Optional session identifier accepted by any Journeyman provider operation.
 *
 * Threaded end-to-end so callers can tie a sequence of calls (across
 * coding-cli, git-provider, issue-provider, notification-provider) to a
 * single logical session. The Claude provider uses it to resume a real
 * Agent SDK session (warm prompt cache). REST providers currently pass it
 * through — useful for future SDK-backed implementations and for correlating
 * calls in logs today.
 */
export type SessionOptions = {
  sessionId?: string;
};

/**
 * Session identifier returned by a provider operation.
 *
 * - Claude Agent SDK-backed operations (coding-cli Claude provider): ALWAYS
 *   populated at runtime — either the caller's id or a generated UUID — so
 *   callers can chain subsequent calls, even on error paths.
 * - REST-backed operations (git-provider, issue-provider, notification-
 *   provider): echo `opts.sessionId` if the caller provided one, otherwise
 *   leave unset. There is no session to generate because REST is stateless.
 *
 * Declared optional so both shapes share one type. The stronger "always
 * populated" guarantee for Claude ops is a runtime contract of that provider.
 */
export type SessionResult = {
  sessionId?: string;
};
