/**
 * @file shutdown.ts
 * Graceful shutdown helpers for SIGTERM / SIGINT handling.
 *
 * `installShutdownHandler` registers OS signal handlers that:
 *   1. Cancel every in-flight pipeline run.
 *   2. Poll `waitForDrain` until all runs have stopped (or timeout is exceeded).
 *   3. Call `onClose` (e.g. `app.close()` to shut down the HTTP server).
 *   4. Exit the process with code 0.
 *
 * This ensures in-progress steps can clean up and persist their final state
 * before the process exits, rather than being killed mid-step.
 */

import { createLogger } from "@journeyman/core";
import type { Pipeline } from "./pipeline.ts";

const log = createLogger("pipeline:shutdown");

/** Poll until no runs are in flight, or timeout exceeded. */
export async function waitForDrain(pipeline: Pipeline, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (pipeline.listRunning().length > 0 && Date.now() < deadline) {
    await new Promise(r => setTimeout(r, 250));
  }
}

/**
 * Install SIGTERM/SIGINT handlers that:
 * 1. Cancel all in-flight runs.
 * 2. Wait up to `timeoutMs` (default 30s) for cancellations to complete.
 * 3. Call onClose (e.g. app.close()).
 * 4. Exit 0.
 */
export function installShutdownHandler(
  pipeline: Pipeline,
  onClose: () => Promise<void>,
  timeoutMs = 30_000,
): void {
  const shutdown = async (signal: string) => {
    log.info({ signal }, "shutdown signal received, draining");
    for (const id of pipeline.listRunning()) pipeline.cancel(id);
    await waitForDrain(pipeline, timeoutMs);
    await onClose();
    process.exit(0);
  };
  process.once("SIGTERM", () => shutdown("SIGTERM"));
  process.once("SIGINT",  () => shutdown("SIGINT"));
}
