/**
 * Optional session identifier accepted by any coding-cli operation.
 * When provided, the provider resumes the existing Claude Agent SDK session
 * (warm prompt cache). When omitted, the provider generates a fresh UUID.
 */
export type SessionOptions = {
  sessionId?: string;
};

/**
 * Session identifier returned by every coding-cli operation — either the
 * value the caller passed in, or the UUID the provider generated. Always
 * populated, including on error paths, so callers can chain or log.
 */
export type SessionResult = {
  sessionId: string;
};
