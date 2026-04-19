import pino from "pino";

const level = process.env.LOG_LEVEL ?? "info";
const isDev = process.env.NODE_ENV !== "production";

const root = pino({
  level,
  transport: isDev
    ? { target: "pino-pretty", options: { colorize: true, translateTime: "HH:MM:ss.l" } }
    : undefined,
});

export type Logger = pino.Logger;

export function createLogger(namespace: string): Logger {
  return root.child({ ns: namespace });
}
