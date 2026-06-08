import { createOpencode, createOpencodeClient, type OpencodeClient } from "@opencode-ai/sdk/v2";
import type { OpenCodeProviderConfig } from "./types.ts";
import { applyEnv, freePort } from "./server-config.ts";

export type OpenCodeClient = OpencodeClient;

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
      timeout: config.timeout,
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
