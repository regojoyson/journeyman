// packages/coding-cli/src/providers/opencode/utils/sdk-logger.ts
import type { Logger } from "@journeyman/core";

export function logSessionEvent(
  log: Logger,
  sessionId: string,
  info: { error?: unknown; structured_output?: unknown; [k: string]: unknown },
): void {
  log.debug({
    sessionId,
    hasError: !!info.error,
    hasStructuredOutput: !!info.structured_output,
  }, "opencode session result");
}
