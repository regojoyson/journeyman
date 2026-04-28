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

const root = pino({
  level,
  // pino-pretty is a Node transport — only enable it server-side.
  transport: isDev && !isBrowser
    ? { target: "pino-pretty", options: { colorize: true, translateTime: "HH:MM:ss.l" } }
    : undefined,
  // In the browser, pino auto-falls back to a console-based logger.
  browser: { asObject: true },
});

export type Logger = pino.Logger;

export function createLogger(namespace: string): Logger {
  return root.child({ ns: namespace });
}
