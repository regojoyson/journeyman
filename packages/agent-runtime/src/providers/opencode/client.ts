import { createOpencode, createOpencodeClient, type OpencodeClient } from "@opencode-ai/sdk/v2";
import type { OpenCodeProviderConfig } from "./types.ts";

const DEFAULT_PERMISSION = { bash: "allow", edit: "allow", webfetch: "allow" } as const;

export type OpenCodeClient = OpencodeClient;

export async function getClient(config: OpenCodeProviderConfig): Promise<OpenCodeClient> {
  const permission = { ...DEFAULT_PERMISSION, ...config.permission };

  if (config.mode === "managed") {
    const { client } = await createOpencode({
      hostname: config.hostname,
      port: config.port,
      timeout: config.timeout,
      config: {
        permission,
        tools: config.tools,
        mcp: config.mcp,
      } as any,
    });
    return client;
  }

  return createOpencodeClient({
    baseUrl: config.baseUrl ?? "http://localhost:4096",
  });
}
