import pino from "pino";

// Guard env access so this module is safe to import from browser bundles.
// (`@journeyman/core` is consumed by both the Node-side packages and the
// React UI packages via the same barrel — `process` is undefined in browsers.)
const env: Record<string, string | undefined> =
  (typeof process !== "undefined" && process.env) ? process.env : {};

const level = env.LOG_LEVEL ?? "info";
const isDev = env.NODE_ENV !== "production";
const isBrowser = typeof process === "undefined"
  || typeof (globalThis as { window?: unknown }).window !== "undefined";

// Logs MUST go to stderr (fd 2), never stdout. The container runner reserves
// stdout for its result JSON (it parses the child's stdout as JSON), so any log
// line on stdout corrupts that contract. stderr is also the conventional stream
// for diagnostics. This applies to both the dev pretty transport and prod JSON.
const root = isBrowser
  ? // In the browser, pino auto-falls back to a console-based logger.
    pino({ level, browser: { asObject: true } })
  : isDev
    ? pino({
        level,
        transport: {
          target: "pino-pretty",
          options: { colorize: true, translateTime: "HH:MM:ss.l", destination: 2 },
        },
      })
    : pino({ level }, pino.destination(2));

export type Logger = pino.Logger;

export function createLogger(namespace: string): Logger {
  return root.child({ ns: namespace });
}

export { createWorkflowLogger, loggerForRun, type WorkflowLogCtx } from "./log/workflow-logger.ts";
export { serializeError, type SerializedError } from "./log/serialize-error.ts";
export { redactString, redactObject } from "./log/redact.ts";
export { LogTail } from "./log/log-tail.ts";
export { appendStepEvent, type MinimalEventBus } from "./log/append-step-event.ts";
