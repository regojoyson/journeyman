import { createOpencode, createOpencodeClient, type OpencodeClient } from "@opencode-ai/sdk/v2";
import type { OpenCodeProviderConfig } from "./types.ts";
import { applyEnv, freePort } from "./server-config.ts";

export type OpenCodeClient = OpencodeClient;

/**
 * Default managed-server startup timeout (ms). The SDK does
 * `setTimeout(reject, options.timeout)`, and an undefined timeout is coerced to 0
 * — i.e. it rejects immediately with "Timeout waiting for server to start after
 * undefinedms". So we always pass an explicit, generous default (first runs may
 * fetch provider packages). Override via OPENCODE_SERVER_TIMEOUT_MS.
 */
const DEFAULT_SERVER_TIMEOUT_MS = 60_000;

function resolveServerTimeout(configTimeout: number | undefined): number {
  if (typeof configTimeout === "number" && configTimeout > 0) return configTimeout;
  const env = Number(process.env.OPENCODE_SERVER_TIMEOUT_MS);
  return Number.isFinite(env) && env > 0 ? env : DEFAULT_SERVER_TIMEOUT_MS;
}

export interface OpenCodeServerHandle {
  client: OpenCodeClient;
  /** Stop the managed server (no-op in external mode) and restore injected env. */
  close: () => void;
}

/**
 * Start (or connect to) an OpenCode server for ONE operation. Managed mode spawns
 * `opencode serve` on a free port with the given Config, injecting `env` into the
 * process for the server's lifetime; close() stops it and restores env.
 */
export async function startServer(
  config: OpenCodeProviderConfig,
  serverConfig: Record<string, unknown>,
  env: Record<string, string> | undefined,
): Promise<OpenCodeServerHandle> {
  if (config.mode === "external") {
    return {
      client: createOpencodeClient({ baseUrl: config.baseUrl ?? "http://localhost:4096" }),
      close: () => {},
    };
  }

  const restore = applyEnv(env);
  try {
    const port = config.port ?? (await freePort());
    const { client, server } = await createOpencode({
      hostname: config.hostname ?? "127.0.0.1",
      port,
      timeout: resolveServerTimeout(config.timeout),
      config: serverConfig as never,
    });
    return {
      client,
      close: () => {
        try {
          server.close();
        } finally {
          restore();
        }
      },
    };
  } catch (err) {
    restore();
    throw err;
  }
}
